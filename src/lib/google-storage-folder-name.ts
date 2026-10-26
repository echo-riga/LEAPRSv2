import { driveFetch } from '@/lib/google-storage';

export type GoogleStorageOwner = { displayName?: string; emailAddress?: string };

export function ownerFilesFolderName(owner: GoogleStorageOwner, includeEmail = false) {
  const clean = (value?: string) => value?.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const name = clean(owner.displayName) || clean(owner.emailAddress) || 'Storage owner';
  return `${name}'s files${includeEmail && owner.emailAddress && owner.displayName ? ` (${clean(owner.emailAddress)})` : ''}`;
}

export async function getGoogleStorageOwner(token: string): Promise<GoogleStorageOwner> {
  const response = await driveFetch('/about?fields=user(displayName,emailAddress)', token);
  if (!response.ok) throw new Error('Unable to identify the storage folder owner.');
  const result = await response.json() as { user?: GoogleStorageOwner };
  if (!result.user?.emailAddress) throw new Error('Google did not identify the storage folder owner.');
  return result.user;
}

export async function renameLegacyGoogleRoot(token: string, id: string, name: string | undefined, owner: GoogleStorageOwner, includeEmail = false) {
  // Keep folders identified by their saved ID/marker; names never grant trust.
  // Preserve custom names and the original owner's label after a transfer.
  if (name !== 'LEAPRS' && !(includeEmail && name === ownerFilesFolderName(owner))) return;
  const response = await driveFetch('/files/' + encodeURIComponent(id) + '?fields=id', token, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ownerFilesFolderName(owner, includeEmail) }),
  });
  if (!response.ok) throw new Error('Unable to name the storage folder.');
}
