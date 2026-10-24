import { and, eq, inArray } from 'drizzle-orm';
import { auditLogs, capdevFolders, capdevs, requests } from '@/db/schema';
import type { Transaction } from '@/db/transaction';
import { deleteRequestRecords } from '@/lib/request-deletion';

type Actor = { actorId: string; actorName: string; actorEmail: string | null };
type Project = typeof capdevs.$inferSelect;

export async function manageCapdevRecords(tx: Transaction, folderId: number, ids: number[], action: 'archive' | 'delete', actor: Actor, cleanup: (projects: Project[]) => Promise<void>) {
  if (!Number.isSafeInteger(folderId) || folderId <= 0 || !['archive', 'delete'].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error('Select between 1 and 500 valid CapDev projects.');
  }
  const [folder] = await tx.select().from(capdevFolders).where(eq(capdevFolders.id, folderId)).for('update');
  if (!folder) throw new Error('CapDev folder no longer exists.');
  const projects = await tx.select().from(capdevs).where(and(eq(capdevs.folderId, folderId), inArray(capdevs.id, ids))).orderBy(capdevs.id).for('update');
  if (projects.length !== ids.length) throw new Error('Some selected projects are unavailable or belong to another folder.');
  if (projects.some(project => action === 'delete' ? !project.archivedAt : Boolean(project.archivedAt))) {
    throw new Error(action === 'delete' ? 'Archive all selected projects before deleting permanently.' : 'Some selected projects are already archived. Refresh and try again.');
  }
  if (action === 'archive') {
    await tx.update(capdevs).set({ archivedAt: new Date(), updatedAt: new Date(), updatedById: actor.actorId }).where(inArray(capdevs.id, ids));
  } else {
    const children = await tx.select().from(requests).where(inArray(requests.capdevId, ids)).orderBy(requests.id).for('update');
    await cleanup(projects);
    for (const child of children) await deleteRequestRecords(tx, child.id, actor);
    await tx.delete(capdevs).where(inArray(capdevs.id, ids));
  }
  for (const project of projects) {
    await tx.insert(auditLogs).values({ ...actor, action: action === 'archive' ? 'archived' : 'deleted', entityType: 'capdev', entityId: String(project.id), entityLabel: project.aipCode, details: { department: project.department, folderId, bulk: true } });
  }
}
