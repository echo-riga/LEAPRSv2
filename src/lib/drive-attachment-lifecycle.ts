import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '@/db/transaction';
import { googleDriveCleanupJobs, googleDriveResources, googleStorageConnections } from '@/db/schema';

export function attachmentFileIds(...values: unknown[]): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    if (typeof item.id === 'string' && ('url' in item || 'mimeType' in item) && /^[\w-]+$/.test(item.id)) ids.add(item.id);
    Object.values(item).forEach(visit);
  };
  values.forEach(visit);
  return [...ids];
}

export async function lockDriveAttachments(tx: Transaction) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(724103, 3)`);
}

export async function assertAttachmentsNotDeleted(tx: Transaction, ...values: unknown[]) {
  const ids = attachmentFileIds(...values);
  if (!ids.length) return;
  const [deleted] = await tx.select({ id: googleDriveCleanupJobs.fileId }).from(googleDriveCleanupJobs)
    .where(and(inArray(googleDriveCleanupJobs.fileId, ids), eq(googleDriveCleanupJobs.status, 'deleted'))).limit(1);
  if (deleted) throw new Error('An attachment was already removed from Drive. Reload the record before saving.');
}

export async function enqueueDriveCleanup(tx: Transaction, fileId: string, rootFolderId: string, kind: 'file' | 'folder' | 'form' = 'file', graceMs = 0) {
  if (!/^[\w-]+$/.test(fileId) || !/^[\w-]+$/.test(rootFolderId)) throw new Error('Invalid managed Drive resource.');
  if (fileId === rootFolderId) throw new Error('Storage roots cannot be deleted by file cleanup.');
  const nextAttemptAt = new Date(Date.now() + graceMs);
  await tx.insert(googleDriveCleanupJobs).values({ fileId, rootFolderId, kind, nextAttemptAt })
    .onConflictDoUpdate({ target: googleDriveCleanupJobs.fileId,
      set: { rootFolderId, kind, status: 'pending', nextAttemptAt, lastError: null, updatedAt: new Date() },
      setWhere: sql`${googleDriveCleanupJobs.status} <> 'deleted'` });
}

export async function enqueueFileIds(tx: Transaction, ids: string[], kind: 'file' | 'form' = 'file') {
  if (!ids.length) return;
  const resources = await tx.select().from(googleDriveResources).where(inArray(googleDriveResources.fileId, ids));
  const roots = new Map(resources.map(resource => [resource.fileId, resource.rootFolderId]));
  const [legacy] = await tx.select().from(googleStorageConnections).where(eq(googleStorageConnections.isLegacy, true)).limit(1);
  for (const id of new Set(ids)) {
    const root = roots.get(id) || legacy?.rootFolderId || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    if (!root) throw new Error('The original storage root for an attachment is unavailable.');
    await enqueueDriveCleanup(tx, id, root, kind);
  }
}

export async function enqueueRemovedAttachments(tx: Transaction, before: unknown, after: unknown) {
  const kept = new Set(attachmentFileIds(after));
  await enqueueFileIds(tx, attachmentFileIds(before).filter(id => !kept.has(id)));
}

// Conservative matching also protects IDs in legacy URL/string attachment values.
// Immutable audit history deliberately does not keep deleted business files alive.
export async function hasLiveDriveReference(tx: Transaction, id: string) {
  const result = await tx.execute(sql`SELECT EXISTS (
    SELECT 1 FROM capdevs WHERE strpos(additional_info::text, ${id}) > 0
    UNION ALL SELECT 1 FROM requests WHERE strpos(additional_info::text, ${id}) > 0
      OR participant_feedback_form_id = ${id} OR supervisor_evaluation_form_id = ${id}
    UNION ALL SELECT 1 FROM request_status_updates WHERE strpos(additional_info::text, ${id}) > 0 OR strpos(files::text, ${id}) > 0
    UNION ALL SELECT 1 FROM capdev_folders WHERE strpos(reference_image::text, ${id}) > 0
    UNION ALL SELECT 1 FROM request_storage_folders WHERE folder_id = ${id} AND request_id IS NOT NULL
  ) AS referenced`);
  return Boolean(result.rows[0]?.referenced);
}

export async function liveDriveReferences(tx: Transaction, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const result = await tx.execute(sql`SELECT candidate FROM jsonb_array_elements_text(${JSON.stringify([...new Set(ids)])}::jsonb) AS candidates(candidate) WHERE EXISTS (
    SELECT 1 FROM capdevs WHERE strpos(additional_info::text, candidate) > 0
    UNION ALL SELECT 1 FROM requests WHERE strpos(additional_info::text, candidate) > 0
      OR participant_feedback_form_id = candidate OR supervisor_evaluation_form_id = candidate
    UNION ALL SELECT 1 FROM request_status_updates WHERE strpos(additional_info::text, candidate) > 0 OR strpos(files::text, candidate) > 0
    UNION ALL SELECT 1 FROM capdev_folders WHERE strpos(reference_image::text, candidate) > 0
    UNION ALL SELECT 1 FROM request_storage_folders WHERE folder_id = candidate AND request_id IS NOT NULL
  )`);
  return new Set(result.rows.map(row => String(row.candidate)));
}
