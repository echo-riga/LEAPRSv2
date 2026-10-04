import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { requestStorageFolders } from '@/db/schema';
import type { Transaction } from '@/db/transaction';

export async function claimRequestFolder(tx: Transaction, userId: string, requestId: number, additionalInfo: Record<string, unknown>) {
  const folderId = additionalInfo.googleDriveFolderId;
  delete additionalInfo.googleDriveFolderId;
  if (folderId === undefined) return;
  if (typeof folderId !== 'string') throw new Error('Invalid attachment folder.');
  const [folder] = await tx.select().from(requestStorageFolders).where(eq(requestStorageFolders.folderId, folderId)).for('update');
  if (!folder) {
    // Legacy JSON folder IDs remain untrusted. Keep existing file links, but do
    // not adopt or delete an old folder merely because its ID was in the form.
    const existing = await tx.execute(sql`SELECT additional_info->>'googleDriveFolderId' AS folder FROM requests WHERE id = ${requestId}`);
    if (existing.rows[0]?.folder === folderId) return;
  }
  if (!folder || folder.rootFolderId !== process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID ||
      (folder.requestId !== requestId && (folder.requestId !== null || folder.userId !== userId))) {
    throw new Error('You do not have permission to use this attachment folder.');
  }
  await tx.update(requestStorageFolders).set({ requestId }).where(and(eq(requestStorageFolders.folderId, folderId),
    or(isNull(requestStorageFolders.requestId), eq(requestStorageFolders.requestId, requestId))));
  // Kept for existing UI consumers; operations always use the trusted mapping.
  additionalInfo.googleDriveFolderId = folderId;
}
