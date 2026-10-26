import { driveFetch } from '@/lib/google-storage';

export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean;
  ownedByMe?: boolean; owners?: Array<{ permissionId?: string }>; appProperties?: Record<string, string> };

async function checked(response: Response) {
  if (response.ok) return response;
  if (response.status === 403 || response.status === 400) {
    throw new Error('Google blocked the transfer. Both accounts must permit ownership transfers and the new account must have available storage. Transfers between different Workspace organizations or personal and Workspace accounts are not supported.');
  }
  if (response.status === 404) throw new Error('A storage file or folder is no longer available. Restore it in Drive and retry.');
  if (response.status === 429) throw new Error('Google temporarily limited transfers. Wait a few minutes and retry.');
  throw new Error('Google could not complete the transfer. Please retry.');
}

export async function readTransferFile(token: string, fileId: string): Promise<DriveFile> {
  const response = await checked(await driveFetch('/files/' + encodeURIComponent(fileId) +
    '?fields=id,name,mimeType,parents,trashed,ownedByMe,owners(permissionId),appProperties', token));
  const file = await response.json() as DriveFile;
  if (!file.id || file.trashed) throw new Error('A storage file or folder is in the trash. Restore it in Drive and retry.');
  return file;
}

export async function listTransferChildren(token: string, folderId: string, pageToken?: string | null) {
  // IDs come only from server-owned roots and Google's listing, never a client request.
  if (!/^[\w-]+$/.test(folderId)) throw new Error('Invalid managed storage folder.');
  const params = new URLSearchParams({ q: `'${folderId}' in parents and trashed = false`, pageSize: '100',
    fields: 'nextPageToken,files(id,name,mimeType)' });
  if (pageToken) params.set('pageToken', pageToken);
  const response = await checked(await driveFetch('/files?' + params, token));
  return response.json() as Promise<{ files?: DriveFile[]; nextPageToken?: string }>;
}

export async function transferDriveOwnership(input: {
  fileId: string; sourceToken: string; targetToken: string; targetAccountId: string; targetEmail: string;
}) {
  const { fileId, sourceToken, targetToken, targetAccountId, targetEmail } = input;
  const path = '/files/' + encodeURIComponent(fileId);
  const file = await readTransferFile(sourceToken, fileId);
  // Retrying after a lost provider response must not send another ownership invitation.
  if (!file.owners?.some(owner => owner.permissionId === targetAccountId)) {
    if (!file.ownedByMe) throw new Error('The previous storage account does not own this file. Its owner must transfer it before migration can continue.');
    const response = await checked(await driveFetch(path + '/permissions?fields=permissions(id,emailAddress,role)&pageSize=100', sourceToken));
    const permissions = await response.json() as { permissions?: Array<{ id: string; emailAddress?: string; role?: string }> };
    const existing = permissions.permissions?.find(permission => permission.id === targetAccountId || permission.emailAddress?.toLowerCase() === targetEmail.toLowerCase());
    const permissionPath = path + '/permissions' + (existing ? '/' + encodeURIComponent(existing.id) : '');
    const method = existing ? 'PATCH' : 'POST';
    const headers = { 'Content-Type': 'application/json' };
    // Consumer accounts require an invitation accepted with the destination's token.
    const pending = await driveFetch(permissionPath + '?fields=id', sourceToken, { method, headers,
      body: JSON.stringify({ role: 'writer', pendingOwner: true, ...(!existing ? { type: 'user', emailAddress: targetEmail } : {}) }) });
    if (pending.ok) {
      const permission = await pending.json() as { id?: string };
      if (!permission.id) throw new Error('Google did not return the ownership permission.');
      await checked(await driveFetch(path + '/permissions/' + encodeURIComponent(permission.id) + '?transferOwnership=true', targetToken,
        { method: 'PATCH', headers, body: JSON.stringify({ role: 'owner' }) }));
    } else if (pending.status === 400 || pending.status === 403) {
      // Same-organization Workspace accounts use a direct transfer instead.
      await checked(await driveFetch(permissionPath + '?transferOwnership=true&moveToNewOwnersRoot=false', sourceToken, { method, headers,
        body: JSON.stringify({ role: 'owner', ...(!existing ? { type: 'user', emailAddress: targetEmail } : {}) }) }));
    } else {
      await checked(pending);
    }
  }
  const verified = await readTransferFile(targetToken, fileId);
  if (!verified.ownedByMe || !verified.owners?.some(owner => owner.permissionId === targetAccountId)) {
    throw new Error('Google has not confirmed the new file owner. Please retry.');
  }
  return verified;
}

export async function finishTransferredRoot(sourceRoot: string, targetRoot: string, token: string) {
  const file = await readTransferFile(token, sourceRoot);
  const params = new URLSearchParams({ fields: 'id,parents' });
  if (!file.parents?.includes(targetRoot)) params.set('addParents', targetRoot);
  const remove = file.parents?.filter(parent => parent !== targetRoot);
  if (remove?.length) params.set('removeParents', remove.join(','));
  const response = await checked(await driveFetch('/files/' + encodeURIComponent(sourceRoot) + '?' + params, token, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    // Prevent OAuth discovery from treating migrated subfolders as competing active roots.
    body: JSON.stringify({ appProperties: { ...file.appProperties, leaprsStorageRoot: 'migrated' } }),
  }));
  const result = await response.json() as { id?: string; parents?: string[] };
  if (result.id !== sourceRoot || !result.parents?.includes(targetRoot)) throw new Error('Unable to verify the destination folder. Please retry.');
}
