import { and, eq, sql } from 'drizzle-orm';
import { capdevFolders } from '@/db/schema';
import type { Transaction } from '@/db/transaction';

// Serialize activation, initial folder creation, and folder deletion.
export async function lockFolderSelection(tx: Transaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(724103, 1)`);
}

export async function activateCapdevFolder(tx: Transaction, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Choose a valid CapDev folder.');
  await lockFolderSelection(tx);
  const [folder] = await tx.select().from(capdevFolders).where(eq(capdevFolders.id, id)).for('update');
  if (!folder) throw new Error('CapDev folder no longer exists.');
  await tx.update(capdevFolders).set({ isActive: false }).where(eq(capdevFolders.isActive, true));
  const [active] = await tx.update(capdevFolders).set({ isActive: true }).where(eq(capdevFolders.id, id)).returning();
  return active;
}

// A shared lock prevents a folder switch from overtaking an authorized write.
export async function assertActiveFolderAccess(tx: Transaction, role: string, folderId: number) {
  if (role === 'admin') return;
  const [folder] = await tx.select({ id: capdevFolders.id }).from(capdevFolders)
    .where(and(eq(capdevFolders.id, folderId), eq(capdevFolders.isActive, true))).for('share');
  if (!folder) throw new Error('This CapDev folder is no longer active. Return to the active folder.');
}
