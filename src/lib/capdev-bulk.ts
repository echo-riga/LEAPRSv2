import { and, eq, inArray } from 'drizzle-orm';
import { auditLogs, capdevFolders, capdevs, requests } from '@/db/schema';
import type { Transaction } from '@/db/transaction';
import { deleteRequestRecords } from '@/lib/request-deletion';
import { lockFolderSelection } from '@/lib/active-capdev-folder';

type Actor = { actorId: string; actorName: string; actorEmail: string | null };
type Project = typeof capdevs.$inferSelect;

export async function manageCapdevRecords(tx: Transaction, folderId: number, ids: number[], action: 'archive' | 'delete' | 'move', actor: Actor, cleanup: (projects: Project[]) => Promise<void>, destinationFolderId?: number) {
  if (!Number.isSafeInteger(folderId) || folderId <= 0 || !['archive', 'delete', 'move'].includes(action) || !Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new Error('Select between 1 and 500 valid CapDev projects.');
  }
  if (action === 'move' && (!Number.isSafeInteger(destinationFolderId) || !destinationFolderId || destinationFolderId <= 0 || destinationFolderId === folderId)) throw new Error('Choose a different destination folder.');
  if (action === 'move') await lockFolderSelection(tx);
  const folderIds = action === 'move' ? [folderId, destinationFolderId!] : [folderId];
  const folders = await tx.select().from(capdevFolders).where(inArray(capdevFolders.id, folderIds)).orderBy(capdevFolders.id).for('update');
  if (folders.length !== folderIds.length) throw new Error('A selected CapDev folder no longer exists.');
  const projects = await tx.select().from(capdevs).where(and(eq(capdevs.folderId, folderId), inArray(capdevs.id, ids))).orderBy(capdevs.id).for('update');
  if (projects.length !== ids.length) throw new Error('Some selected projects are unavailable or belong to another folder.');
  if (action !== 'move' && projects.some(project => action === 'delete' ? !project.archivedAt : Boolean(project.archivedAt))) {
    throw new Error(action === 'delete' ? 'Archive all selected projects before deleting permanently.' : 'Some selected projects are already archived. Refresh and try again.');
  }
  if (action === 'archive') {
    await tx.update(capdevs).set({ archivedAt: new Date(), updatedAt: new Date(), updatedById: actor.actorId }).where(inArray(capdevs.id, ids));
  } else if (action === 'move') {
    await tx.update(capdevs).set({ folderId: destinationFolderId, updatedAt: new Date(), updatedById: actor.actorId }).where(inArray(capdevs.id, ids));
  } else {
    const children = await tx.select().from(requests).where(inArray(requests.capdevId, ids)).orderBy(requests.id).for('update');
    await cleanup(projects);
    for (const child of children) await deleteRequestRecords(tx, child.id, actor);
    await tx.delete(capdevs).where(inArray(capdevs.id, ids));
  }
  for (const project of projects) {
    await tx.insert(auditLogs).values({ ...actor, action: action === 'move' ? 'updated' : action === 'archive' ? 'archived' : 'deleted', entityType: 'capdev', entityId: String(project.id), entityLabel: project.aipCode, details: { department: project.department, folderId, bulk: true, ...(action === 'move' ? { destinationFolderId, changes: [{ field: 'folderId', label: 'Folder', from: folders.find(folder => folder.id === folderId)!.name, to: folders.find(folder => folder.id === destinationFolderId)!.name }] } : {}) } });
  }
}
