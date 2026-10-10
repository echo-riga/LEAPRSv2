import { notifications } from '@/db/schema';
import type { Transaction } from '@/db/transaction';

export type NotificationEvent = {
  userId?: string | null; actorId?: string | null; capdevId?: number | null; requestId?: number | null;
  title: string; message: string; link: string; type?: string;
};

// Let insert failures propagate so the enclosing business transaction rolls back.
export async function insertNotificationEvent(tx: Transaction, event: NotificationEvent) {
  const [created] = await tx.insert(notifications).values({
    ...event, actorId: event.actorId || null, userId: event.userId || null,
    capdevId: event.capdevId || null, requestId: event.requestId || null, type: event.type || 'status_update',
  }).returning();
  return created;
}
