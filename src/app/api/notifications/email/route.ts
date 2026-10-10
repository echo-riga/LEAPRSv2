import { timingSafeEqual } from 'node:crypto';
import { deliverNotificationEmails } from '@/lib/notification-email';
import { syncRequestReminders } from '@/lib/request-reminders';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret || Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await syncRequestReminders({ userId: 'system', role: 'admin', department: '' });
    const result = await deliverNotificationEmails();
    return Response.json(result, { status: result.configured ? 200 : 503 });
  } catch {
    return Response.json({ error: 'Unable to process notification emails.' }, { status: 500 });
  }
}
