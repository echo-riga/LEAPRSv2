import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Resend } from 'resend';
import { db } from '@/db';
import { capdevs, requests, notifications, emailNotificationPreferences, notificationEmailDeliveries, type NotificationEmailPayload } from '@/db/schema';
import { notificationAudienceCondition } from '@/lib/notification-audience';
import { DEFAULT_EMAIL_TYPES } from '@/lib/notification-types';
import { requestNotificationWording } from '@/lib/notification-wording';

type Recipient = { id: string; role: string; department: string; email: string; enabled_types: string[] | null };

function logDeliveryError(stage: string, error: unknown) {
  // Drizzle wraps database errors; inspect causes without logging queries or parameters.
  const details: string[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const item = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    const message = typeof item.message === 'string' && !item.message.startsWith('Failed query:') ? item.message : '';
    details.push([item.name, item.code, message].filter(value => typeof value === 'string').join(': '));
    current = item.cause;
  }
  let summary = details.filter(Boolean).join(' → ') || 'Unknown delivery error';
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|RESEND_FROM/i.test(name)) summary = summary.split(value).join('[redacted]');
  }
  summary = summary.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[URL redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]');
  console.error(`[Notification email: ${stage}] ${summary.slice(0, 1000)}`);
}

export function notificationEmailPayload(event: { title: string; message: string; link: string }, email: string, origin: string): NotificationEmailPayload {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid APP_URL.');
  if (!event.link.startsWith('/portal') || event.link.startsWith('//')) throw new Error('Invalid notification link.');
  const link = new URL(event.link, base.origin);
  if (link.origin !== base.origin) throw new Error('Invalid notification origin.');
  return {
    from: process.env.RESEND_FROM || 'LEAPRS <onboarding@resend.dev>',
    to: email,
    subject: `LEAPRS · ${event.title}`,
    text: `${event.title}\n\n${event.message}\n\nOpen LEAPRS: ${link.href}\n\nManage email preferences in LEAPRS → Notifications → Configure Email Notifications.`,
  };
}

async function recipients(userId?: string): Promise<Recipient[]> {
  const result = await db.execute(sql`
    SELECT u.id, u.role, u.department, a.email, p.enabled_types
    FROM users u INNER JOIN neon_auth.user a ON a.id::text = u.id
    LEFT JOIN email_notification_preferences p ON p.user_id = u.id
    WHERE u.archived_at IS NULL AND a.email IS NOT NULL
      AND u.role IN ('admin', 'employee', 'employee-department', 'viewer', 'viewer-full')
      ${userId ? sql`AND u.id = ${userId}` : sql``}
  `);
  return result.rows as Recipient[];
}

function audience(recipient: Recipient) {
  return notificationAudienceCondition({ userId: recipient.id, role: recipient.role, department: recipient.department });
}

// The same audience query used by the in-app panel is evaluated again before delivery.
export async function deliverNotificationEmails() {
  const apiKey = process.env.RESEND_API_KEY || process.env.RESEND;
  const origin = process.env.APP_URL || process.env.MCP_PUBLIC_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  if (!apiKey || !origin) return { sent: 0, configured: false };
  const members = await recipients();
  // Durable recipient rows also record opted-out events, so enabling a type never floods old mail.
  for (const member of members) {
    const events = await db.select({ event: notifications, requestorName: requests.requestorName }).from(notifications)
      .leftJoin(requests, eq(notifications.requestId, requests.id))
      .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id))
      .leftJoin(notificationEmailDeliveries, and(eq(notificationEmailDeliveries.notificationId, notifications.id), eq(notificationEmailDeliveries.userId, member.id)))
      .where(and(eq(notifications.emailEligible, true), audience(member), isNull(notificationEmailDeliveries.id)))
      .orderBy(asc(notifications.id)).limit(50);
    if (!events.length) continue;
    await db.insert(notificationEmailDeliveries).values(events.map(({ event, requestorName }) => ({
      notificationId: event.id, userId: member.id,
      status: (member.enabled_types ?? DEFAULT_EMAIL_TYPES).includes(event.type) ? 'pending' : 'skipped',
      payload: notificationEmailPayload({ ...event,
        title: requestNotificationWording(event.title, requestorName),
        message: requestNotificationWording(event.message, requestorName),
      }, member.email, origin),
    }))).onConflictDoNothing();
  }

  const client = new Resend(apiKey);
  const candidates = await db.select().from(notificationEmailDeliveries).where(sql`
    (${notificationEmailDeliveries.status} = 'pending' OR
      (${notificationEmailDeliveries.status} = 'processing' AND ${notificationEmailDeliveries.claimedAt} < NOW() - INTERVAL '5 minutes'))
    AND ${notificationEmailDeliveries.nextAttemptAt} <= NOW()
  `).orderBy(asc(notificationEmailDeliveries.id)).limit(20);
  let sent = 0;
  for (const delivery of candidates) {
    const token = randomUUID();
    const claimed = await db.execute(sql`
      UPDATE notification_email_deliveries SET status = 'processing', claim_token = ${token}, claimed_at = NOW(),
        first_attempt_at = COALESCE(first_attempt_at, NOW()), attempts = attempts + 1
      WHERE id = ${delivery.id} AND (status = 'pending' OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '5 minutes'))
        AND next_attempt_at <= NOW() RETURNING attempts, first_attempt_at < NOW() - INTERVAL '20 hours' AS expired
    `);
    if (!claimed.rows.length) continue;
    const attempt = Number(claimed.rows[0].attempts);
    const expired = Boolean(claimed.rows[0].expired);
    const [member] = await recipients(delivery.userId);
    const [visible] = member ? await db.select({ type: notifications.type }).from(notifications)
      .leftJoin(requests, eq(notifications.requestId, requests.id))
      .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id))
      .where(and(eq(notifications.id, delivery.notificationId), audience(member))).limit(1) : [];
    // Re-read preferences: they may have changed since queuing or since this worker started.
    const [preference] = await db.select().from(emailNotificationPreferences).where(eq(emailNotificationPreferences.userId, delivery.userId)).limit(1);
    if (expired || attempt > 5 || !visible || !member || member.email !== delivery.payload.to ||
      !(preference?.enabledTypes ?? DEFAULT_EMAIL_TYPES).includes(visible.type)) {
      await db.execute(sql`UPDATE notification_email_deliveries SET status = ${expired || attempt > 5 ? 'failed' : 'skipped'}
        WHERE id = ${delivery.id} AND claim_token = ${token}`);
      continue;
    }
    try {
      const { error } = await client.emails.send(delivery.payload, { idempotencyKey: `notification/${delivery.notificationId}/${delivery.userId}` });
      if (error) {
        logDeliveryError('Resend rejected delivery', error);
        throw new Error(error.name);
      }
      await db.execute(sql`UPDATE notification_email_deliveries SET status = 'sent', sent_at = NOW()
        WHERE id = ${delivery.id} AND claim_token = ${token}`);
      sent++;
    } catch (error) {
      logDeliveryError('delivery attempt failed', error);
      // Identical persisted payload and provider idempotency key make uncertain retries safe.
      await db.execute(sql`UPDATE notification_email_deliveries SET status = ${attempt >= 5 ? 'failed' : 'pending'},
        next_attempt_at = NOW() + ${Math.min(900, 30 * 2 ** attempt)} * INTERVAL '1 second'
        WHERE id = ${delivery.id} AND claim_token = ${token}`);
    }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  return { sent, configured: true };
}

export function scheduleNotificationEmails() {
  after(async () => {
    try { await deliverNotificationEmails(); }
    catch (error) {
      logDeliveryError('background processing failed', error);
      console.error('Notification email delivery will be retried on the next refresh or scheduled run.');
    }
  });
}
