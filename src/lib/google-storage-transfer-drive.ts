import { driveFetch } from '@/lib/google-storage';

export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean;
  ownedByMe?: boolean; owners?: Array<{ permissionId?: string }>; appProperties?: Record<string, string> };

async function checked(response: Response, operation = 'complete the transfer') {
  if (response.ok) return response;
  const body = await response.json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
  const rawReason = body?.error?.errors?.[0]?.reason;
  const reason = rawReason && /^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(rawReason) ? rawReason : undefined;
  const reference = `(HTTP ${response.status}${reason ? '; ' + reason : ''})`;
  if (reason === 'ownershipChangeAcrossDomainsNotPermitted') throw new Error(`Google does not permit ownership transfers between these account organizations ${reference}. Choose a compatible destination account.`);
  if (reason === 'ownershipChangeRequiresConsent') throw new Error(`Google requires the destination account to accept pending ownership ${reference}. Reconnect the destination and retry.`);
  if (reason === 'storageQuotaExceeded') throw new Error(`Google reports that the destination account has insufficient storage ${reference}. Free storage and retry.`);
  if (reason === 'insufficientFilePermissions' || reason === 'appNotAuthorizedToFile') throw new Error(`Google denied permission to ${operation} ${reference}. Reconnect the participating accounts and retry.`);
  if (response.status === 404) throw new Error('A storage file or folder is no longer available. Restore it in Drive and retry.');
  if (response.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') throw new Error(`Google temporarily limited transfers ${reference}. Wait a few minutes and retry.`);
  throw new Error(`Google could not ${operation} ${reference}. Reconnect the participating accounts and retry.`);
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
    let permission = permissions.permissions?.find(permission => permission.id === targetAccountId || permission.emailAddress?.toLowerCase() === targetEmail.toLowerCase());
    const headers = { 'Content-Type': 'application/json' };
    if (!permission) {
      // Drive may ignore pendingOwner in permissions.create and return only a
      // writer. Establish the share, then explicitly update pending ownership.
      const shared = await checked(await driveFetch(path + '/permissions?fields=id&sendNotificationEmail=false', sourceToken, {
        method: 'POST', headers, body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: targetEmail }),
      }), 'share the file with the destination');
      permission = await shared.json() as { id: string };
      if (!permission.id) throw new Error('Google did not return the file permission.');
    }
    const permissionPath = path + '/permissions/' + encodeURIComponent(permission.id);
    // Consumer accounts require an invitation accepted with the destination's token.
    const pending = await driveFetch(permissionPath + '?fields=id,pendingOwner', sourceToken, { method: 'PATCH', headers,
      body: JSON.stringify({ role: 'writer', pendingOwner: true }) });
    if (pending.ok) {
      const invitation = await pending.json() as { pendingOwner?: boolean };
      if (invitation.pendingOwner === true) {
        await checked(await driveFetch(permissionPath + '?transferOwnership=true', targetToken,
          { method: 'PATCH', headers, body: JSON.stringify({ role: 'owner' }) }), 'accept pending ownership');
      } else {
        // Workspace accounts can omit pending ownership and transfer directly.
        await checked(await driveFetch(permissionPath + '?transferOwnership=true', sourceToken,
          { method: 'PATCH', headers, body: JSON.stringify({ role: 'owner' }) }), 'transfer ownership');
      }
    } else if (pending.status === 400 || pending.status === 403) {
      const details = await pending.clone().json().catch(() => null) as { error?: { errors?: Array<{ reason?: string }> } } | null;
      const reason = details?.error?.errors?.[0]?.reason;
      if (reason && !['invalidSharingRequest', 'badRequest', 'invalid', 'userCannotAddPendingOwnerToFile'].includes(reason)) await checked(pending, 'request pending ownership');
      await checked(await driveFetch(permissionPath + '?transferOwnership=true', sourceToken, { method: 'PATCH', headers,
        body: JSON.stringify({ role: 'owner' }) }), 'transfer ownership');
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
