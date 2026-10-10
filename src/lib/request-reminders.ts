import { and, asc, desc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { db } from '@/db';
import { capdevs, notifications, requests, requestStatusUpdates, systemSettings } from '@/db/schema';
import {
  DEFAULT_INACTIVITY_DAYS, INACTIVITY_SETTING_KEY, inactivityMessage,
  requestInactivity, validInactivityDays, type RequestInactivity,
} from '@/lib/request-inactivity';

type ReminderAccess = { userId: string; role: string; department: string };

export async function readInactivityDays() {
  const [setting] = await db.select({ days: systemSettings.numberValue }).from(systemSettings)
    .where(eq(systemSettings.key, INACTIVITY_SETTING_KEY)).limit(1);
  return validInactivityDays(setting?.days) ? setting.days : DEFAULT_INACTIVITY_DAYS;
}

export async function getRequestInactivitySummaries(requestIds: number[]) {
  const result = new Map<number, RequestInactivity>();
  if (!requestIds.length) return result;
  const [days, records, updates] = await Promise.all([
    readInactivityDays(),
    db.select({ request: requests, parentArchivedAt: capdevs.archivedAt }).from(requests)
      .innerJoin(capdevs, eq(requests.capdevId, capdevs.id)).where(inArray(requests.id, requestIds)),
    db.select({ id: requestStatusUpdates.id, requestId: requestStatusUpdates.requestId,
      createdAt: requestStatusUpdates.createdAt, markAsComplete: requestStatusUpdates.markAsComplete })
      .from(requestStatusUpdates).where(inArray(requestStatusUpdates.requestId, requestIds))
      .orderBy(desc(requestStatusUpdates.createdAt), desc(requestStatusUpdates.id)),
  ]);
  const latest = new Map<number, typeof updates[number]>();
  const completed = new Set<number>();
  for (const update of updates) {
    if (!latest.has(update.requestId)) latest.set(update.requestId, update);
    if (update.markAsComplete) completed.add(update.requestId);
  }
  const now = new Date();
  for (const record of records) {
    const info = requestInactivity(record.request, latest.get(record.request.id) ?? null, days,
      { parentArchived: Boolean(record.parentArchivedAt), legacyComplete: completed.has(record.request.id), now });
    if (info) result.set(record.request.id, info);
  }
  return result;
}

// Recheck live activity when reading/marking reminders, so a new timeline entry,
// conclusion, archive, or changed threshold immediately hides an obsolete event.
export function activeReminderCondition() {
  const latestId = sql`(SELECT u.id FROM request_status_updates u WHERE u.request_id = ${requests.id}
    ORDER BY u.created_at DESC, u.id DESC LIMIT 1)`;
  const lastActivity = sql`COALESCE((SELECT u.created_at FROM request_status_updates u
    WHERE u.request_id = ${requests.id} ORDER BY u.created_at DESC, u.id DESC LIMIT 1), ${requests.createdAt})`;
  const days = sql`COALESCE((SELECT number_value FROM system_settings WHERE key = ${INACTIVITY_SETTING_KEY}), ${DEFAULT_INACTIVITY_DAYS})`;
  return and(
    eq(notifications.type, 'inactivity_reminder'), eq(requests.status, 'in_progress'),
    isNull(requests.archivedAt), isNull(capdevs.archivedAt),
    sql`${notifications.reminderKey} = 'request:' || ${requests.id}::text || ':' ||
      CASE WHEN ${latestId} IS NULL THEN 'submitted' ELSE 'update:' || (${latestId})::text END`,
    sql`${lastActivity} <= NOW() - ${days} * INTERVAL '1 day'`,
    notExists(db.select({ id: requestStatusUpdates.id }).from(requestStatusUpdates)
      .where(and(eq(requestStatusUpdates.requestId, requests.id), eq(requestStatusUpdates.markAsComplete, true)))),
  )!;
}

export async function syncRequestReminders(access: ReminderAccess) {
  const scope = access.role === 'employee' ? eq(requests.userId, access.userId)
    : access.role === 'viewer' ? eq(capdevs.department, access.department) : undefined;
  const records = await db.select({ id: requests.id, capdevId: requests.capdevId,
    requestorName: requests.requestorName, aipCode: capdevs.aipCode }).from(requests)
    .innerJoin(capdevs, eq(requests.capdevId, capdevs.id))
    .where(and(scope, eq(requests.status, 'in_progress'), isNull(requests.archivedAt), isNull(capdevs.archivedAt)))
    .orderBy(asc(requests.id));
  // Bounded batches prevent oversized IN lists and inserts in large portals.
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100);
    const summaries = await getRequestInactivitySummaries(batch.map((record) => record.id));
    const values = batch.flatMap((record) => {
      const info = summaries.get(record.id);
      return info ? [{
        capdevId: record.capdevId, requestId: record.id, actorId: null,
        type: 'inactivity_reminder', reminderKey: info.reminderKey,
        title: 'Request Inactivity Reminder',
        message: (record.requestorName || 'Requestor') + ' · ' + record.aipCode + ': ' + inactivityMessage(info.days),
        link: info.link, createdAt: info.dueAt,
      }] : [];
    });
    if (values.length) await db.insert(notifications).values(values)
      .onConflictDoNothing({ target: notifications.reminderKey });
  }
}
