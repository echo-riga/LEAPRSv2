import { driveFetch } from '@/lib/google-storage';

export const DRIVE_FORM = 'application/vnd.google-apps.form';

async function responseAccess(fileId: string, token: string) {
  return fetch((process.env.GOOGLE_STORAGE_FORMS_API_URL || 'https://forms.googleapis.com/v1') +
    '/forms/' + encodeURIComponent(fileId) + '/responses?pageSize=1', {
    headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
}

// Legacy forms can live outside the managed tree, including in a school account
// that cannot transfer ownership to a consumer account. Editor access preserves
// the original form, its responses, and its owner without copying anything.
export async function ensureEvaluationFormAccess(input: {
  fileId: string; sourceToken: string; targetToken: string; targetAccountId: string; targetEmail: string;
}) {
  const { fileId, sourceToken, targetToken, targetAccountId, targetEmail } = input;
  const initial = await responseAccess(fileId, targetToken);
  if (initial.ok) { await initial.body?.cancel(); return; }
  await initial.body?.cancel();
  if (initial.status !== 403) throw new Error('Google could not verify evaluation response access. Check the form and retry.');
  const path = '/files/' + encodeURIComponent(fileId) + '/permissions';
  let pageToken: string | undefined;
  let existing: { id: string; role: string } | undefined;
  do {
    const params = new URLSearchParams({ fields: 'nextPageToken,permissions(id,emailAddress,role)', pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveFetch(path + '?' + params, sourceToken);
    if (!response.ok) throw new Error('Google could not inspect evaluation form sharing. Reconnect its original owner and retry.');
    const data = await response.json() as { nextPageToken?: string; permissions?: Array<{ id: string; emailAddress?: string; role: string }> };
    existing = data.permissions?.find(p => p.id === targetAccountId || p.emailAddress?.toLowerCase() === targetEmail.toLowerCase());
    pageToken = data.nextPageToken;
  } while (!existing && pageToken);
  if (!existing || !['owner', 'writer', 'organizer', 'fileOrganizer'].includes(existing.role)) {
    const response = await driveFetch(path + (existing ? '/' + encodeURIComponent(existing.id) : '') +
      '?sendNotificationEmail=false', sourceToken, {
      method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', ...(!existing ? { type: 'user', emailAddress: targetEmail } : {}) }),
    });
    if (!response.ok) throw new Error('Google blocked Editor access to an evaluation form. Its owner or organization must allow sharing with the destination account.');
  }
  const verified = await responseAccess(fileId, targetToken);
  await verified.body?.cancel();
  if (!verified.ok) throw new Error('Google has not confirmed evaluation response access for the destination account. Check Forms permissions and retry.');
}
