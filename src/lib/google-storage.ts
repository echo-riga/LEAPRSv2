import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { googleStorageConnections, googleDriveResources, requestStorageFolders } from '@/db/schema';
import { decryptGoogleSecret, encryptGoogleSecret } from '@/lib/google-storage-crypto';

export type GoogleStorage = typeof googleStorageConnections.$inferSelect;
export const GOOGLE_STORAGE_SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/forms.body', 'https://www.googleapis.com/auth/forms.responses.readonly'];

export function googleOAuthCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth client credentials are not configured.');
  return { clientId, clientSecret };
}

export async function googleTokenRequest(values: Record<string, string>) {
  const { clientId, clientSecret } = googleOAuthCredentials();
  const response = await fetch(process.env.GOOGLE_STORAGE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...values }),
  });
  if (!response.ok) throw new Error('Google authorization failed. Reconnect the storage account in Settings.');
  const token = await response.json() as { access_token?: string; refresh_token?: string; scope?: string };
  if (!token.access_token) throw new Error('Google did not return an access token.');
  return token;
}

export function driveFetch(path: string, token: string, init?: RequestInit) {
  return fetch((process.env.GOOGLE_STORAGE_DRIVE_API_URL || 'https://www.googleapis.com/drive/v3') + path, {
    ...init, cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { ...init?.headers, Authorization: 'Bearer ' + token },
  });
}

function environmentStorage(): GoogleStorage | null {
  const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim(), token = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  return root && token ? { id: 'environment', accountId: 'legacy:' + root, email: 'Previous storage account', rootFolderId: root,
    encryptedRefreshToken: encryptGoogleSecret(token), isActive: true, isLegacy: true, connectedById: null, updatedAt: new Date() } : null;
}

export async function getActiveGoogleStorage(): Promise<GoogleStorage> {
  const [connection] = await db.select().from(googleStorageConnections).where(eq(googleStorageConnections.isActive, true)).limit(1);
  const storage = connection || environmentStorage();
  if (!storage) throw new Error('Connect a Google Drive account in Settings first.');
  return storage;
}

export async function getGoogleStorageForRoot(root: string): Promise<GoogleStorage> {
  const [connection] = await db.select().from(googleStorageConnections).where(eq(googleStorageConnections.rootFolderId, root)).limit(1);
  if (connection) return connection;
  const legacy = environmentStorage();
  if (legacy?.rootFolderId === root) return legacy;
  throw new Error('The original Google storage connection is unavailable.');
}

export async function listGoogleStorages() {
  const connections = await db.select().from(googleStorageConnections);
  const legacy = environmentStorage();
  if (legacy && !connections.some(connection => connection.rootFolderId === legacy.rootFolderId)) connections.push(legacy);
  return connections;
}

export async function getGoogleStorageToken(storage: GoogleStorage) {
  return (await googleTokenRequest({ grant_type: 'refresh_token', refresh_token: decryptGoogleSecret(storage.encryptedRefreshToken) })).access_token!;
}

export async function getCurrentGoogleStorageOwner(): Promise<{ email: string | null } | null> {
  const [connection] = await db.select().from(googleStorageConnections).where(eq(googleStorageConnections.isActive, true)).limit(1);
  const storage = connection || environmentStorage();
  if (!storage) return null;
  if (storage.email.includes('@')) return { email: storage.email };
  try {
    const token = await getGoogleStorageToken(storage);
    const response = await driveFetch('/about?fields=user(emailAddress)', token);
    if (!response.ok) return { email: null };
    const { user } = await response.json() as { user?: { emailAddress?: string } };
    const email = user?.emailAddress;
    if (!email || !email.includes('@')) return { email: null };
    if (connection) await db.update(googleStorageConnections).set({ email }).where(and(
      eq(googleStorageConnections.id, connection.id), eq(googleStorageConnections.encryptedRefreshToken, connection.encryptedRefreshToken),
    ));
    return { email };
  } catch { return { email: null }; }
}

export async function getGoogleDriveAccessToken(rootFolderId?: string) {
  return getGoogleStorageToken(rootFolderId ? await getGoogleStorageForRoot(rootFolderId) : await getActiveGoogleStorage());
}

export async function getGoogleResourceRoot(fileId: string) {
  const [resource] = await db.select().from(googleDriveResources).where(eq(googleDriveResources.fileId, fileId)).limit(1);
  if (resource) return resource.rootFolderId;
  // Unregistered files predate this feature and belong to the original account.
  const [legacy] = await db.select().from(googleStorageConnections).where(eq(googleStorageConnections.isLegacy, true)).limit(1);
  const root = legacy?.rootFolderId || environmentStorage()?.rootFolderId;
  if (!root) throw new Error('The original storage account for this file is unknown.');
  return root;
}

export async function registerGoogleResource(fileId: string, rootFolderId: string) {
  await getGoogleStorageForRoot(rootFolderId);
  await db.insert(googleDriveResources).values({ fileId, rootFolderId }).onConflictDoNothing();
  const [resource] = await db.select().from(googleDriveResources).where(eq(googleDriveResources.fileId, fileId));
  if (resource?.rootFolderId !== rootFolderId) throw new Error('Google file storage ownership does not match.');
}

export async function getStorageRootForParent(parentFolderId: string) {
  const [root] = await db.select({ id: googleStorageConnections.rootFolderId }).from(googleStorageConnections).where(eq(googleStorageConnections.rootFolderId, parentFolderId));
  if (root) return root.id;
  if (environmentStorage()?.rootFolderId === parentFolderId) return parentFolderId;
  const [folder] = await db.select().from(requestStorageFolders).where(eq(requestStorageFolders.folderId, parentFolderId));
  if (!folder) throw new Error('Untrusted Google storage folder.');
  await getGoogleStorageForRoot(folder.rootFolderId);
  return folder.rootFolderId;
}

export type GoogleFileMetadata = { id: string; name: string; mimeType: string; size: string; webViewLink?: string; parents?: string[]; appProperties?: Record<string, string>; trashed?: boolean };

export async function findGoogleUpload(fileId: string) {
  const [resource] = await db.select().from(googleDriveResources).where(eq(googleDriveResources.fileId, fileId));
  const storages = resource ? [await getGoogleStorageForRoot(resource.rootFolderId)] : await listGoogleStorages();
  for (const storage of storages) {
    try {
      const token = await getGoogleStorageToken(storage);
      const response = await driveFetch('/files/' + encodeURIComponent(fileId) + '?fields=id,name,mimeType,size,webViewLink,parents,appProperties,trashed', token);
      if (!response.ok) continue;
      const file = await response.json() as GoogleFileMetadata;
      if (resource || file.appProperties?.leaprsStorageRoot === storage.rootFolderId || (storage.isLegacy && !file.appProperties?.leaprsStorageRoot)) return { file, token, storage };
    } catch { /* Continue looking in retained connections. */ }
  }
  throw new Error('Unable to verify the uploaded file in its original storage account.');
}
