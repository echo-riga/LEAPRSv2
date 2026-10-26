import { and, asc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { withTransaction, type Transaction } from '@/db/transaction';
import { googleDriveCleanupJobs as jobs, googleDriveCleanupScans as scans, googleStorageConnections, googleStorageMigrations, requestStorageFolders } from '@/db/schema';
import { driveFetch, getGoogleStorageForRoot, getGoogleStorageToken, listGoogleStorages } from '@/lib/google-storage';
import { hasLiveDriveReference, liveDriveReferences } from '@/lib/drive-attachment-lifecycle';

const FOLDER = 'application/vnd.google-apps.folder';
const DAY = 24 * 60 * 60 * 1000;
type Metadata = { id: string; mimeType: string; parents?: string[]; trashed?: boolean; ownedByMe?: boolean; appProperties?: Record<string, string> };

async function metadata(token: string, id: string): Promise<Metadata | null> {
  const response = await driveFetch('/files/' + encodeURIComponent(id) + '?fields=id,mimeType,parents,trashed,ownedByMe,appProperties', token);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Drive metadata HTTP ' + response.status);
  return response.json();
}

async function isInsideRoot(token: string, file: Metadata, root: string) {
  const pending = [...(file.parents || [])];
  const visited = new Set<string>();
  while (pending.length && visited.size < 32) {
    const id = pending.shift()!;
    if (id === root) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const parent = await metadata(token, id);
    if (parent && !parent.trashed) pending.push(...(parent.parents || []));
  }
  return false;
}

async function retain(tx: Transaction, id: string) {
  await tx.update(jobs).set({ status: 'retained', lastError: null, updatedAt: new Date() }).where(eq(jobs.fileId, id));
}

async function processOne() {
  return withTransaction(async tx => {
    // Same lock as attachment writes. A new reference cannot race the final check.
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(724103, 3) AS acquired`);
    if (!lock.rows[0]?.acquired) return false;
    const storageLock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(724103, 2) AS acquired`);
    if (!storageLock.rows[0]?.acquired) return false;
    const [migration] = await tx.select({ id: googleStorageMigrations.id }).from(googleStorageMigrations)
      .where(ne(googleStorageMigrations.status, 'completed')).limit(1);
    // Keep migration's file inventory stable. Unlinks still save immediately;
    // their durable cleanup jobs wait until ownership transfers are finished.
    if (migration) return false;
    const [job] = await tx.select().from(jobs).where(and(inArray(jobs.status, ['pending', 'failed']), lte(jobs.nextAttemptAt, new Date())))
      .orderBy(asc(jobs.nextAttemptAt), asc(jobs.createdAt)).limit(1).for('update');
    if (!job) return false;
    try {
      const [root] = await tx.select({ id: googleStorageConnections.id }).from(googleStorageConnections).where(eq(googleStorageConnections.rootFolderId, job.fileId)).limit(1);
      if (root || job.fileId === job.rootFolderId || await hasLiveDriveReference(tx, job.fileId)) {
        await retain(tx, job.fileId); return true;
      }
      const current = await getGoogleStorageForRoot(job.rootFolderId);
      let token = await getGoogleStorageToken(current);
      let file = await metadata(token, job.fileId);
      let unavailableOwner = false;
      if (!file || file.ownedByMe === false) {
        // A late upload or an old generated form can still be owned by an earlier
        // retained account even though its containing root has transferred.
        for (const original of await listGoogleStorages()) {
          if (original.id === current.id) continue;
          try {
            const originalToken = await getGoogleStorageToken(original);
            const candidate = await metadata(originalToken, job.fileId);
            if (candidate && (!file || candidate.ownedByMe)) { token = originalToken; file = candidate; }
            if (file?.ownedByMe) break;
          } catch { unavailableOwner = true; }
        }
      }
      if (!file && unavailableOwner) throw new Error('An original storage connection is unavailable');
      if (!file || file.trashed) {
        await tx.update(jobs).set({ status: 'deleted', lastError: null, updatedAt: new Date() }).where(eq(jobs.fileId, job.fileId));
        if (job.kind === 'folder') await tx.delete(requestStorageFolders).where(and(eq(requestStorageFolders.folderId, job.fileId), isNull(requestStorageFolders.requestId)));
        return true;
      }
      if ((file.mimeType === FOLDER) !== (job.kind === 'folder')) throw new Error('Managed resource type mismatch');
      if (job.kind === 'form' && file.mimeType !== 'application/vnd.google-apps.form') throw new Error('Managed resource type mismatch');
      if (file.appProperties?.leaprsUploadId && await hasLiveDriveReference(tx, file.appProperties.leaprsUploadId)) {
        await retain(tx, job.fileId); return true;
      }
      // Evaluation form jobs come only from server-generated form IDs or their
      // original registration, never from a client-supplied attachment descriptor.
      if (job.kind !== 'form' && !await isInsideRoot(token, file, job.rootFolderId)) throw new Error('Resource is outside its registered storage root');
      if (job.kind === 'folder') {
        // Delete children separately so shared files and pending uploads are checked
        // individually. Never recursively delete a folder that still has content.
        const params = new URLSearchParams({ q: `'${file.id}' in parents and trashed = false`, pageSize: '100', fields: 'nextPageToken,files(id,mimeType)' });
        if (job.pageToken) params.set('pageToken', job.pageToken);
        const response = await driveFetch('/files?' + params, token);
        if (!response.ok) {
          if (response.status === 400 && job.pageToken) {
            await tx.update(jobs).set({ pageToken: null, nextAttemptAt: new Date(Date.now() + 60000) }).where(eq(jobs.fileId, job.fileId));
            return true;
          }
          throw new Error('Drive folder listing HTTP ' + response.status);
        }
        const data = await response.json() as { files?: Array<{ id: string; mimeType: string }>; nextPageToken?: string };
        if (data.files?.length) {
          await tx.insert(jobs).values(data.files.map(child => ({ fileId: child.id, rootFolderId: job.rootFolderId,
            kind: child.mimeType === FOLDER ? 'folder' : 'file', nextAttemptAt: new Date() }))).onConflictDoNothing();
          await tx.update(jobs).set({ status: 'pending', pageToken: data.nextPageToken || null,
            nextAttemptAt: new Date(Date.now() + (data.nextPageToken ? 60000 : 30 * 60000)), lastError: null, updatedAt: new Date() })
            .where(eq(jobs.fileId, job.fileId));
          return true;
        }
        // A paginated scan reaching the end must rescan from the beginning before
        // deleting. Referenced children may remain on earlier pages.
        if (job.pageToken) {
          await tx.update(jobs).set({ pageToken: null, nextAttemptAt: new Date(Date.now() + 60000) }).where(eq(jobs.fileId, job.fileId));
          return true;
        }
      }
      // Recheck immediately before the provider mutation, while holding the lock.
      if (await hasLiveDriveReference(tx, job.fileId)) { await retain(tx, job.fileId); return true; }
      const deletion = await driveFetch('/files/' + encodeURIComponent(job.fileId), token, { method: 'DELETE' });
      if (!deletion.ok && deletion.status !== 404) throw new Error('Drive deletion HTTP ' + deletion.status);
      await tx.update(jobs).set({ status: 'deleted', lastError: null, pageToken: null, updatedAt: new Date() }).where(eq(jobs.fileId, job.fileId));
      if (job.kind === 'folder') await tx.delete(requestStorageFolders).where(and(eq(requestStorageFolders.folderId, job.fileId), isNull(requestStorageFolders.requestId)));
      if (file.parents?.length) await tx.update(jobs).set({ status: 'pending', nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(and(inArray(jobs.fileId, file.parents), eq(jobs.kind, 'folder'), inArray(jobs.status, ['pending', 'retained'])));
    } catch (error) {
      const message = error instanceof Error && /^(Drive (metadata|folder listing|deletion) HTTP \d{3}|Resource is outside its registered storage root|Managed resource type mismatch)$/.test(error.message)
        ? error.message : 'Storage authorization or cleanup failed; reconnect the storage account if retries continue to fail.';
      const delay = Math.min(DAY, 60000 * 2 ** Math.min(job.attempts, 10));
      await tx.update(jobs).set({ status: 'failed', attempts: job.attempts + 1, lastError: message,
        nextAttemptAt: new Date(Date.now() + delay), updatedAt: new Date() }).where(eq(jobs.fileId, job.fileId));
    }
    return true;
  });
}

export async function processDriveCleanup(limit = 3, timeBudgetMs = 40000) {
  let processed = 0;
  const started = Date.now();
  while (processed < limit && Date.now() - started < timeBudgetMs && await processOne()) processed++;
  return { processed };
}

// Only server-tagged uploads are reconciled. An arbitrary old Drive file is never
// adopted/deleted just because no database reference happens to match it.
export async function discoverUnreferencedDriveUploads() {
  const storages = await listGoogleStorages();
  const started = Date.now();
  let failedRoots = 0;
  for (const original of storages) {
    let more = true;
    while (more && Date.now() - started < 60000) {
      more = false;
      try {
        await withTransaction(async tx => {
          const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(724103, 3) AS acquired`);
          if (!lock.rows[0]?.acquired) return;
          const [cursor] = await tx.select().from(scans).where(eq(scans.rootFolderId, original.rootFolderId));
          // Keep the query cutoff identical for every page in a scan, including
          // a continuation. Changing the query can invalidate provider page tokens.
          const scanTime = cursor?.pageToken ? cursor.updatedAt : new Date();
          const cutoff = new Date(scanTime.getTime() - DAY).toISOString();
          const token = await getGoogleStorageToken(await getGoogleStorageForRoot(original.rootFolderId));
          const params = new URLSearchParams({ q: "trashed = false and createdTime < '" + cutoff + "' and appProperties has { key='leaprsStorageRoot' and value='" + original.rootFolderId + "' }",
            pageSize: '1000', fields: 'nextPageToken,files(id,mimeType,appProperties)' });
          if (cursor?.pageToken) params.set('pageToken', cursor.pageToken);
          const response = await driveFetch('/files?' + params, token);
          if (!response.ok) {
            if (response.status === 400 && cursor?.pageToken) {
              await tx.update(scans).set({ pageToken: null }).where(eq(scans.rootFolderId, original.rootFolderId));
              more = true;
            } else failedRoots++;
            return;
          }
          const data = await response.json() as { files?: Array<Metadata>; nextPageToken?: string };
          const files = (data.files || []).filter(file => file.mimeType !== FOLDER && file.appProperties?.leaprsStorageRoot === original.rootFolderId);
          const referenced = await liveDriveReferences(tx, files.flatMap(file => [file.id, file.appProperties?.leaprsUploadId].filter((id): id is string => Boolean(id))));
          const candidates = files.filter(file => !referenced.has(file.id) && !(file.appProperties?.leaprsUploadId && referenced.has(file.appProperties.leaprsUploadId)));
          if (candidates.length) await tx.insert(jobs).values(candidates.map(file => ({ fileId: file.id, rootFolderId: original.rootFolderId, nextAttemptAt: new Date() }))).onConflictDoUpdate({
            target: jobs.fileId, set: { status: 'pending', nextAttemptAt: new Date(), updatedAt: new Date() }, setWhere: eq(jobs.status, 'retained'),
          });
          await tx.insert(scans).values({ rootFolderId: original.rootFolderId, pageToken: data.nextPageToken || null, updatedAt: scanTime })
            .onConflictDoUpdate({ target: scans.rootFolderId, set: { pageToken: data.nextPageToken || null, updatedAt: scanTime } });
          more = Boolean(data.nextPageToken);
        });
      } catch {
        // One unavailable retained account must not block other roots or queued jobs.
        failedRoots++;
      }
    }
  }
  return { failedRoots };
}

export async function driveCleanupStatus() {
  const result = await db.select({ status: jobs.status, count: sql<number>`count(*)::integer` }).from(jobs).groupBy(jobs.status);
  return Object.fromEntries(result.map(row => [row.status, row.count]));
}

export async function retryFailedDriveCleanup() {
  await db.update(jobs).set({ nextAttemptAt: new Date() }).where(eq(jobs.status, 'failed'));
}
