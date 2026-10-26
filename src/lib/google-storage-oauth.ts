import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { driveFetch, googleOAuthCredentials } from '@/lib/google-storage';
import { decryptGoogleSecret, encryptGoogleSecret } from '@/lib/google-storage-crypto';
import { getGoogleStorageOwner, ownerFilesFolderName, renameLegacyGoogleRoot, type GoogleStorageOwner } from '@/lib/google-storage-folder-name';

export const GOOGLE_OAUTH_COOKIE = 'leaprs-google-storage';
type Flow = { state: string; verifier: string; userId: string; redirectUri: string; expiresAt: number };
type Folder = { id: string; name?: string; mimeType?: string; ownedByMe?: boolean; trashed?: boolean;
  appProperties?: Record<string, string>; capabilities?: { canAddChildren?: boolean } };

export function googleStorageCallbackUri() {
  const url = new URL(process.env.APP_URL || '');
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Set APP_URL to the website address.');
  return url.origin + '/api/google-storage/callback';
}

export function createGoogleStorageFlow(userId: string, redirectUri: string) {
  const flow: Flow = { userId, redirectUri, state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 600000 };
  return { flow, cookie: encryptGoogleSecret(JSON.stringify(flow)), challenge: createHash('sha256').update(flow.verifier).digest('base64url') };
}

export function verifyGoogleStorageFlow(cookie: string, state: string, userId: string): Flow {
  const flow = JSON.parse(decryptGoogleSecret(cookie)) as Flow;
  const a = Buffer.from(flow.state || ''), b = Buffer.from(state || '');
  if (!state || a.length !== b.length || !timingSafeEqual(a, b) || flow.userId !== userId || !Number.isFinite(flow.expiresAt) || flow.expiresAt < Date.now() || flow.redirectUri !== googleStorageCallbackUri()) throw new Error('Google connection expired. Start again from Settings.');
  return flow;
}

function marker() { return createHash('sha256').update(googleOAuthCredentials().clientId).digest('hex').slice(0, 32); }
const folderType = 'application/vnd.google-apps.folder';

export async function inspectGoogleRoot(token: string, id: string) {
  const response = await driveFetch('/files/' + encodeURIComponent(id) + '?fields=id,name,mimeType,ownedByMe,trashed,appProperties,capabilities(canAddChildren)', token);
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error('Unable to check the LEAPRS folder.');
  const folder = await response.json() as Folder;
  return !folder.trashed && folder.ownedByMe && folder.mimeType === folderType && folder.capabilities?.canAddChildren ? folder : null;
}

async function folderSearch(token: string, query: string) {
  const folders: Folder[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: query, fields: 'nextPageToken,files(id,name,mimeType,ownedByMe,trashed,appProperties,capabilities(canAddChildren))', pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveFetch('/files?' + params, token);
    if (!response.ok) throw new Error('Unable to find the LEAPRS folder.');
    const data = await response.json() as { files?: Folder[]; nextPageToken?: string };
    folders.push(...(data.files || []).filter(folder => folder.ownedByMe && !folder.trashed && folder.capabilities?.canAddChildren));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return folders;
}

export async function findOrCreateGoogleRoot(token: string, savedFolderId?: string, connectedOwner?: GoogleStorageOwner) {
  const owner = connectedOwner || await getGoogleStorageOwner(token);
  const appMarker = marker();
  const properties = { leaprsStorageRoot: 'v1', leaprsClient: appMarker };
  if (savedFolderId) {
    const saved = await inspectGoogleRoot(token, savedFolderId);
    if (saved && saved.appProperties?.leaprsClient === appMarker) {
      await renameLegacyGoogleRoot(token, saved.id, saved.name, owner);
      return saved.id;
    }
  }
  const base = `trashed = false and mimeType = '${folderType}' and 'me' in owners`;
  const marked = await folderSearch(token, base + ` and appProperties has { key='leaprsClient' and value='${appMarker}' } and appProperties has { key='leaprsStorageRoot' and value='v1' }`);
  if (marked.length > 1) throw new Error('More than one managed LEAPRS folder was found. Rename or remove duplicate copies and reconnect.');
  if (marked[0]) {
    await renameLegacyGoogleRoot(token, marked[0].id, marked[0].name, owner);
    return marked[0].id;
  }
  // An existing, unmarked LEAPRS folder may be adopted only when it is the
  // single matching folder owned by this account directly in My Drive.
  const existing = (await folderSearch(token, base + " and 'root' in parents and name = 'LEAPRS'"))
    .filter(folder => !folder.appProperties?.leaprsClient || folder.appProperties.leaprsClient === appMarker);
  if (existing.length > 1) throw new Error('Multiple LEAPRS folders exist in My Drive. Rename the extra folders and reconnect.');
  if (existing[0]) {
    const response = await driveFetch('/files/' + encodeURIComponent(existing[0].id), token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ownerFilesFolderName(owner), appProperties: { ...existing[0].appProperties, ...properties } }) });
    if (!response.ok) throw new Error('Unable to identify the existing LEAPRS folder.');
    return existing[0].id;
  }
  const response = await driveFetch('/files?fields=id', token, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ownerFilesFolderName(owner), mimeType: folderType, parents: ['root'], appProperties: properties }) });
  if (!response.ok) throw new Error('Unable to create the LEAPRS folder.');
  const folder = await response.json() as { id?: string };
  if (!folder.id) throw new Error('Google did not return the LEAPRS folder.');
  return folder.id;
}
