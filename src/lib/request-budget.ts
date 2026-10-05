import { ARCHIVED_READ_ONLY, isArchiveReadOnly } from '@/lib/archive-policy';
import { and, eq, sql } from 'drizzle-orm';
import { capdevs, requests, requestStatusUpdates } from '@/db/schema';
import type { Transaction } from '@/db/transaction';
import { validateMoney } from '@/lib/request-validation';

type UpdateInput = Omit<typeof requestStatusUpdates.$inferInsert, 'id' | 'createdAt'> & { deductedAmount?: string };

// Called inside one transaction. Any validation or insert failure rolls back the balance.
export async function writeRequestStatusUpdate(tx: Transaction, role: string, input: UpdateInput) {
  const [current] = await tx.select().from(requests).where(eq(requests.id, input.requestId)).for('update');
  if (!current || ['completed', 'denied'].includes(current.status)) throw new Error('This request is already concluded.');
  const [parent] = await tx.select().from(capdevs).where(eq(capdevs.id, current.capdevId)).for('update');
  if (isArchiveReadOnly(current, parent)) throw new Error(ARCHIVED_READ_ONLY);
  if (role === 'employee' && current.userId !== input.userId) throw new Error('You do not have permission to perform this action.');
  if (current.isStopped && (role !== 'employee' || !input.isStopperResponse || input.stopperId !== current.activeStopperId)) throw new Error('This request is stopped.');
  if (current.isStopped && current.activeStopperId) {
    const [stopper] = await tx.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.id, current.activeStopperId));
    if (stopper?.archivedAt) throw new Error(ARCHIVED_READ_ONLY);
  }
  if (!current.isStopped && input.isStopperResponse) throw new Error('This request is no longer stopped.');
  if (input.isStopperResponse && (input.subtractsRequestedAmount || input.markAsComplete)) throw new Error('A stopper response cannot deduct budget or complete a request.');
  if (input.subtractsRequestedAmount) {
    if (current.budgetDeductedAt) throw new Error('Budget has already been deducted for this request.');
    const [already] = await tx.select({ id: requestStatusUpdates.id }).from(requestStatusUpdates)
      .where(and(eq(requestStatusUpdates.requestId, input.requestId), eq(requestStatusUpdates.subtractsRequestedAmount, true))).limit(1);
    if (already) throw new Error('Budget has already been deducted for this request.');
    const amount = validateMoney(input.deductedAmount || current.requestedBudget);
    const deducted = await tx.update(capdevs).set({ budget: sql`${capdevs.budget} - ${amount}::numeric`, updatedAt: new Date() })
      .where(and(eq(capdevs.id, current.capdevId), sql`${capdevs.budget} >= ${amount}::numeric`)).returning({ id: capdevs.id });
    if (!deducted.length) throw new Error('Insufficient CapDev budget balance to deduct.');
    await tx.update(requests).set({ requestedBudget: amount, budgetDeductedAt: new Date(), updatedAt: new Date() }).where(eq(requests.id, input.requestId));
  }
  const [update] = await tx.insert(requestStatusUpdates).values({
    requestId: input.requestId, userId: input.userId, authorName: input.authorName,
    statusUpdate: input.statusUpdate, remarks: input.remarks, files: input.files,
    statusMark: input.statusMark, markAsComplete: input.markAsComplete,
    subtractsRequestedAmount: input.subtractsRequestedAmount, isStopperResponse: input.isStopperResponse,
    stopperId: input.stopperId, additionalInfo: input.additionalInfo,
  }).returning({ id: requestStatusUpdates.id });
  return update;
}
