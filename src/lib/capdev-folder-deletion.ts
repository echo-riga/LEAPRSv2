import { lockFolderSelection } from '@/lib/active-capdev-folder';
import { eq, inArray } from 'drizzle-orm';
import { auditLogs, capdevFolders, capdevs, requests } from '@/db/schema';
import type { Transaction } from '@/db/transaction';
import { deleteRequestRecords } from '@/lib/request-deletion';

type Actor = { actorId: string; actorName: string; actorEmail: string | null };

// The Admin action locks the folder and descendants and cleans managed storage
// before calling this helper. Every database deletion and audit commits together.
export async function deleteCapdevFolderRecords(tx: Transaction, folderId: number, actor: Actor) {
  await lockFolderSelection(tx);
  const [folder] = await tx.select().from(capdevFolders).where(eq(capdevFolders.id, folderId)).for('update');
  if (!folder) throw new Error('CapDev folder no longer exists.');
  if (folder.isActive) throw new Error('Activate another folder before deleting this folder.');
  const projects = await tx.select().from(capdevs).where(eq(capdevs.folderId, folderId)).orderBy(capdevs.id).for('update');
  const projectIds = projects.map(project => project.id);
  if (projectIds.length) {
    const children = await tx.select().from(requests).where(inArray(requests.capdevId, projectIds)).orderBy(requests.id).for('update');
    for (const child of children) await deleteRequestRecords(tx, child.id, actor);
    for (const project of projects) {
      await tx.insert(auditLogs).values({ ...actor, action: 'deleted', entityType: 'capdev', entityId: String(project.id), entityLabel: project.aipCode, details: { department: project.department, folderId, folderName: folder.name } });
    }
    await tx.delete(capdevs).where(inArray(capdevs.id, projectIds));
  }
  await tx.delete(capdevFolders).where(eq(capdevFolders.id, folderId));
  await tx.insert(auditLogs).values({ ...actor, action: 'deleted', entityType: 'capdev_folder', entityId: String(folderId), entityLabel: folder.name, details: { projectCount: projects.length } });
}
