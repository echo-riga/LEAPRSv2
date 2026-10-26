import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { withTransaction, type Transaction } from '@/db/transaction';
import { googleStorageConnections, googleStorageMigrations, googleStorageMigrationItems } from '@/db/schema';
import { encryptGoogleSecret } from '@/lib/google-storage-crypto';
import { driveFetch, getGoogleStorageToken, type GoogleStorage } from '@/lib/google-storage';
import { DRIVE_FOLDER, finishTransferredRoot, listTransferChildren, readTransferFile, transferDriveOwnership } from '@/lib/google-storage-transfer-drive';
import { getGoogleStorageOwner, ownerFilesFolderName, renameLegacyGoogleRoot } from '@/lib/google-storage-folder-name';

export async function assertStorageMigrationIdle(tx: Transaction) {
  const [job] = await tx.select({ id: googleStorageMigrations.id }).from(googleStorageMigrations)
    .where(ne(googleStorageMigrations.status, 'completed')).limit(1);
  if (job) throw new Error('Finish the current file transfer before changing storage accounts again.');
}

export async function retargetFailedStorageMigrations(tx: Transaction, targetRoot: string) {
  const jobs = await tx.select().from(googleStorageMigrations).where(ne(googleStorageMigrations.status, 'completed'))
    .orderBy(asc(googleStorageMigrations.createdAt), asc(googleStorageMigrations.id)).for('update');
  if (!jobs.length) return;
  if (jobs[0].status !== 'failed') throw new Error('Finish the current file transfer before changing storage accounts again.');
  for (const job of jobs) {
    if (job.sourceRoot === targetRoot) throw new Error('Choose a separate destination storage root.');
    // Files already transferred remain intact. The worker finds their actual owner
    // among retained connections and transfers them to the replacement destination.
    await tx.update(googleStorageMigrations).set({ targetRoot, status: 'running', phase: 'discovering', error: null, updatedAt: new Date() })
      .where(eq(googleStorageMigrations.id, job.id));
    await tx.update(googleStorageMigrationItems).set({ done: false, scanned: false, pageToken: null })
      .where(eq(googleStorageMigrationItems.migrationId, job.id));
  }
}

export async function retainEnvironmentStorage(tx: Transaction) {
  const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
  const refresh = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (!root || !refresh) return;
  await tx.insert(googleStorageConnections).values({ id: randomUUID(), accountId: 'legacy:' + root,
    email: 'Previous storage account', encryptedRefreshToken: encryptGoogleSecret(refresh), rootFolderId: root,
    isLegacy: true, isActive: false }).onConflictDoNothing();
}

export async function queueStorageMigration(tx: Transaction, source: GoogleStorage | undefined, targetRoot: string) {
  if (!source || source.rootFolderId === targetRoot) return;
  const [existing] = await tx.select({ id: googleStorageMigrations.id }).from(googleStorageMigrations)
    .where(eq(googleStorageMigrations.sourceRoot, source.rootFolderId)).limit(1);
  // Already migrated roots live inside their destination tree and move with it.
  if (existing) return;
  const id = randomUUID();
  await tx.insert(googleStorageMigrations).values({ id, sourceRoot: source.rootFolderId, targetRoot, sourceConnectionId: source.id });
  await tx.insert(googleStorageMigrationItems).values({ migrationId: id, fileId: source.rootFolderId,
    name: 'Previous owner storage folder', mimeType: DRIVE_FOLDER, depth: 0 });
}

export async function getStorageMigrationStatus() {
  const [job] = await db.select().from(googleStorageMigrations).orderBy(
    asc(sql`CASE WHEN ${googleStorageMigrations.status} = 'completed' THEN 1 ELSE 0 END`),
    asc(sql`CASE WHEN ${googleStorageMigrations.status} <> 'completed' THEN ${googleStorageMigrations.createdAt} END`),
    desc(googleStorageMigrations.createdAt), asc(googleStorageMigrations.id)).limit(1);
  if (!job) return null;
  const [counts] = await db.select({ total: sql<number>`count(*)::integer`, completed: sql<number>`count(*) FILTER (WHERE ${googleStorageMigrationItems.done})::integer` })
    .from(googleStorageMigrationItems).where(eq(googleStorageMigrationItems.migrationId, job.id));
  return { id: job.id, status: job.status, phase: job.phase, error: job.error, total: counts.total, completed: counts.completed };
}

// A request performs one bounded page/file operation. Database locking also protects
// against multiple Admins, tabs, retries, and a lost HTTP response after a transfer.
export async function advanceStorageMigration(retry = false) {
  await withTransaction(async tx => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(724103, 2) AS acquired`);
    if (!lock.rows[0]?.acquired) return;
    const [job] = await tx.select().from(googleStorageMigrations).where(ne(googleStorageMigrations.status, 'completed'))
      .orderBy(asc(googleStorageMigrations.createdAt), asc(googleStorageMigrations.id)).limit(1).for('update');
    if (!job || (job.status === 'failed' && !retry)) return;
    try {
      const [source] = await tx.select().from(googleStorageConnections).where(eq(googleStorageConnections.id, job.sourceConnectionId));
      const [target] = await tx.select().from(googleStorageConnections).where(eq(googleStorageConnections.rootFolderId, job.targetRoot));
      if (!source || !target || !target.isActive) throw new Error('The original or destination storage connection is unavailable.');
      const sourceToken = await getGoogleStorageToken(source);
      if (source.accountId.startsWith('legacy:')) {
        const response = await driveFetch('/about?fields=user(permissionId,emailAddress)', sourceToken);
        if (!response.ok) throw new Error('Unable to identify the previous storage account.');
        const { user } = await response.json() as { user?: { permissionId?: string; emailAddress?: string } };
        if (!user?.permissionId || !user.emailAddress) throw new Error('Unable to identify the previous storage account.');
        await tx.update(googleStorageConnections).set({ accountId: user.permissionId, email: user.emailAddress })
          .where(eq(googleStorageConnections.id, source.id));
      }
      if (job.phase === 'discovering' || job.phase === 'verifying') {
        const [folder] = await tx.select().from(googleStorageMigrationItems).where(and(eq(googleStorageMigrationItems.migrationId, job.id),
          eq(googleStorageMigrationItems.mimeType, DRIVE_FOLDER), eq(googleStorageMigrationItems.scanned, false)))
          .orderBy(asc(googleStorageMigrationItems.depth), asc(googleStorageMigrationItems.id)).limit(1);
        if (folder) {
          if (folder.depth === 0 && !folder.pageToken) {
            const root = await readTransferFile(sourceToken, job.sourceRoot);
            if (root.name === 'LEAPRS' || root.name.endsWith("'s files")) {
              const sourceOwner = await getGoogleStorageOwner(sourceToken);
              const targetToken = await getGoogleStorageToken(target);
              const targetOwner = await getGoogleStorageOwner(targetToken);
              const sameName = ownerFilesFolderName(sourceOwner).toLowerCase() === ownerFilesFolderName(targetOwner).toLowerCase()
                && sourceOwner.emailAddress !== targetOwner.emailAddress;
              await renameLegacyGoogleRoot(sourceToken, root.id, root.name, sourceOwner, sameName);
              if (sameName) {
                const targetRoot = await readTransferFile(targetToken, job.targetRoot);
                await renameLegacyGoogleRoot(targetToken, targetRoot.id, targetRoot.name, targetOwner, true);
              }
            }
          }
          const data = await listTransferChildren(sourceToken, folder.fileId, folder.pageToken);
          if (data.files?.length) {
            if (data.files.some(file => file.id === job.targetRoot)) throw new Error('The destination is inside the previous storage folder. Choose a separate LEAPRS storage account.');
            await tx.insert(googleStorageMigrationItems).values(data.files.map(file => ({ migrationId: job.id,
              fileId: file.id, name: file.name, mimeType: file.mimeType, depth: folder.depth + 1 }))).onConflictDoNothing();
          }
          await tx.update(googleStorageMigrationItems).set({ scanned: !data.nextPageToken, pageToken: data.nextPageToken || null })
            .where(eq(googleStorageMigrationItems.id, folder.id));
        } else {
          const [pending] = await tx.select({ id: googleStorageMigrationItems.id }).from(googleStorageMigrationItems)
            .where(and(eq(googleStorageMigrationItems.migrationId, job.id), eq(googleStorageMigrationItems.done, false))).limit(1);
          if (pending) {
            await tx.update(googleStorageMigrations).set({ phase: 'transferring' }).where(eq(googleStorageMigrations.id, job.id));
          } else {
            await finishTransferredRoot(job.sourceRoot, job.targetRoot, await getGoogleStorageToken(target));
            await tx.update(googleStorageMigrations).set({ status: 'completed', error: null, updatedAt: new Date() }).where(eq(googleStorageMigrations.id, job.id));
            return;
          }
        }
      } else {
        const [item] = await tx.select().from(googleStorageMigrationItems)
          .where(and(eq(googleStorageMigrationItems.migrationId, job.id), eq(googleStorageMigrationItems.done, false)))
          .orderBy(desc(googleStorageMigrationItems.depth), asc(googleStorageMigrationItems.id)).limit(1);
        if (item) {
          const targetToken = await getGoogleStorageToken(target);
          // Legacy connections may not yet have their Google identity persisted.
          const response = await driveFetch('/about?fields=user(permissionId,emailAddress)', targetToken);
          if (!response.ok) throw new Error('Unable to verify the destination account. Reconnect it and retry.');
          const { user } = await response.json() as { user?: { permissionId?: string; emailAddress?: string } };
          if (!user?.permissionId || !user.emailAddress) throw new Error('Unable to identify the destination account.');
          let ownerToken = sourceToken;
          const metadata = await readTransferFile(sourceToken, item.fileId);
          // A resumable upload pinned before an earlier switch can still be owned
          // by an older retained account. Use its actual owner for the transfer.
          if (!metadata.ownedByMe && !metadata.owners?.some(owner => owner.permissionId === user.permissionId)) {
            const retained = await tx.select().from(googleStorageConnections);
            for (const connection of retained) {
              if (connection.id === source.id || connection.id === target.id) continue;
              try {
                const token = await getGoogleStorageToken(connection);
                if ((await readTransferFile(token, item.fileId)).ownedByMe) { ownerToken = token; break; }
              } catch { /* Another retained account may own this file. */ }
            }
          }
          await transferDriveOwnership({ fileId: item.fileId, sourceToken: ownerToken, targetToken,
            targetAccountId: user.permissionId, targetEmail: user.emailAddress });
          await tx.update(googleStorageMigrationItems).set({ done: true }).where(eq(googleStorageMigrationItems.id, item.id));
        } else {
          // Discover late uploads before declaring success; keep IDs and the folder tree.
          await tx.update(googleStorageMigrationItems).set({ scanned: false, pageToken: null })
            .where(and(eq(googleStorageMigrationItems.migrationId, job.id), eq(googleStorageMigrationItems.mimeType, DRIVE_FOLDER)));
          await tx.update(googleStorageMigrations).set({ phase: 'verifying' }).where(eq(googleStorageMigrations.id, job.id));
        }
      }
      await tx.update(googleStorageMigrations).set({ status: 'running', error: null, updatedAt: new Date() }).where(eq(googleStorageMigrations.id, job.id));
    } catch (error) {
      // Do not expose provider bodies, tokens, or database errors to the browser.
      const message = error instanceof Error && /^(Google |The previous storage|A storage file|The original or destination|The destination is inside|Unable to (verify|identify) the destination)/.test(error.message)
        ? error.message : 'Unable to transfer files. Check both storage connections and retry.';
      await tx.update(googleStorageMigrations).set({ status: 'failed', error: message, updatedAt: new Date() }).where(eq(googleStorageMigrations.id, job.id));
    }
  });
  return getStorageMigrationStatus();
}
