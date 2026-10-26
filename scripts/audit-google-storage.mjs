// Read-only by default. --rename-roots renames only saved storage connection roots.
// No file, folder, attachment reference, or permission is deleted or moved.
import { registerHooks } from 'node:module';
import { neon } from '@neondatabase/serverless';
import { writeFile } from 'node:fs/promises';

process.loadEnvFile('.env.local');
registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + (specifier === '@/db' ? '/index.ts' : '.ts'), import.meta.url).href : specifier, context);
} });
const { getGoogleStorageToken, getGoogleStorageForRoot, driveFetch } = await import('../src/lib/google-storage.ts');
const { getGoogleStorageOwner, ownerFilesFolderName } = await import('../src/lib/google-storage-folder-name.ts');
const database = neon(process.env.DATABASE_URL);
const [connections, folders, projects, requests, updates, references] = await Promise.all([
  database.query('SELECT * FROM google_storage_connections'),
  database.query('SELECT * FROM request_storage_folders'),
  database.query('SELECT id,additional_info FROM capdevs'),
  database.query('SELECT id,additional_info,participant_feedback_form_id,supervisor_evaluation_form_id FROM requests'),
  database.query('SELECT id,request_id,additional_info,files FROM request_status_updates'),
  database.query('SELECT id,reference_image FROM capdev_folders WHERE reference_image IS NOT NULL'),
]);
const active = connections.find(connection => connection.is_active);
if (!active) throw new Error('No active database storage connection.');
const token = await getGoogleStorageToken({ encryptedRefreshToken: active.encrypted_refresh_token });
const roots = [];
for (const connection of connections) {
  let owner = { emailAddress: connection.email };
  try { owner = await getGoogleStorageOwner(await getGoogleStorageToken({ encryptedRefreshToken: connection.encrypted_refresh_token })); }
  catch { /* Saved original email is still a valid naming fallback. */ }
  roots.push({ id: connection.root_folder_id, email: connection.email, active: connection.is_active, owner });
}
for (const root of roots) {
  root.label = ownerFilesFolderName(root.owner);
  // Two accounts can have the same profile name. Keep the account identity visible.
  if (roots.filter(other => ownerFilesFolderName(other.owner).toLowerCase() === root.label.toLowerCase()).length > 1) root.label += ` (${root.email})`;
  if (process.argv.includes('--rename-roots')) {
    const storage = await getGoogleStorageForRoot(root.id);
    const rootToken = await getGoogleStorageToken(storage);
    const response = await driveFetch('/files/' + encodeURIComponent(root.id) + '?fields=id,name', rootToken, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: root.label }),
    });
    if (!response.ok) throw new Error('Unable to rename a registered storage root (HTTP ' + response.status + ').');
    const renamed = await response.json();
    if (renamed.id !== root.id || renamed.name !== root.label) throw new Error('Storage root rename was not verified.');
  }
}
const used = new Map();
function add(id, label) {
  if (typeof id !== 'string' || !id) return;
  if (!used.has(id)) used.set(id, new Set());
  used.get(id).add(label);
}
function collect(value, label) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(item => collect(item, label)); return; }
  if (typeof value.id === 'string' && ('mimeType' in value || 'url' in value)) add(value.id, label);
  if (typeof value.googleDriveFolderId === 'string') add(value.googleDriveFolderId, label);
  Object.values(value).forEach(item => collect(item, label));
}
projects.forEach(row => collect(row.additional_info, `CapDev #${row.id}`));
requests.forEach(row => {
  collect(row.additional_info, `Request #${row.id}`);
  add(row.participant_feedback_form_id, `Request #${row.id} participant form`);
  add(row.supervisor_evaluation_form_id, `Request #${row.id} supervisor form`);
});
updates.forEach(row => { collect(row.additional_info, `Progress #${row.id} / request #${row.request_id}`); collect(row.files, `Progress #${row.id} / request #${row.request_id}`); });
references.forEach(row => collect(row.reference_image, `CapDev folder #${row.id} reference`));
const files = new Map();
const queue = [{ id: active.root_folder_id, path: roots.find(root => root.active).label, ancestors: [active.root_folder_id] }];
const seen = new Set();
while (queue.length) {
  const folder = queue.shift();
  if (seen.has(folder.id)) continue;
  seen.add(folder.id);
  let pageToken;
  do {
    const params = new URLSearchParams({ q: `'${folder.id}' in parents and trashed = false`, pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,parents,owners(emailAddress))' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await driveFetch('/files?' + params, token);
    if (!response.ok) throw new Error('Unable to audit a storage folder (HTTP ' + response.status + ').');
    const data = await response.json();
    for (const file of data.files || []) {
      files.set(file.id, { ...file, path: folder.path + '/' + file.name, ancestorIds: folder.ancestors });
      if (file.mimeType === 'application/vnd.google-apps.folder') queue.push({ id: file.id, path: folder.path + '/' + file.name, ancestors: [...folder.ancestors, file.id] });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
}
const rootIds = new Set(roots.map(root => root.id));
const folderMap = new Map(folders.map(folder => [folder.folder_id, folder]));
const requestIds = new Set(requests.map(row => row.id));
const inventory = [...files.values()].map(file => ({ ...file, references: [...(used.get(file.id) || [])],
  managedRoot: rootIds.has(file.id), requestId: folderMap.get(file.id)?.request_id ?? null,
  unclaimed: folderMap.has(file.id) && folderMap.get(file.id).request_id === null }));
const missing = [...used].filter(([id]) => !files.has(id) && id !== active.root_folder_id).map(([id, labels]) => ({ id, references: [...labels] }));
for (const item of missing) {
  const response = await driveFetch('/files/' + encodeURIComponent(item.id) + '?fields=id,name,mimeType,trashed,parents', token);
  item.lookupStatus = response.status;
  if (response.ok) item.file = await response.json();
}
const fileItems = inventory.filter(file => file.mimeType !== 'application/vnd.google-apps.folder');
const report = {
  checkedAt: new Date().toISOString(), roots,
  summary: { files: fileItems.length, folders: inventory.length - fileItems.length,
    referencedFiles: fileItems.filter(file => file.references.length).length,
    filesWithoutCurrentReferences: fileItems.filter(file => !file.references.length).length,
    referencedFilesOutsideActiveTree: missing.filter(item => item.lookupStatus === 200 && !item.file?.trashed).length,
    unavailableReferences: missing.filter(item => item.lookupStatus !== 200 || item.file?.trashed).length },
  visibleFolders: inventory.filter(file => file.parents?.includes(active.root_folder_id)).map(file => ({ id: file.id, name: file.name,
    meaning: file.managedRoot ? 'Previous owner storage root' : file.requestId !== null && requestIds.has(file.requestId) ? `Attachment folder for request #${file.requestId}` : file.unclaimed ? 'Prepared upload folder not claimed by a saved request' : file.references.length ? 'Referenced folder: ' + file.references.join(', ') : 'No current database association',
    descendantFiles: fileItems.filter(child => child.ancestorIds.includes(file.id)).length })),
  inventory, outsideTreeReferences: missing,
};
const reportIndex = process.argv.indexOf('--report');
if (reportIndex !== -1) {
  if (!process.argv[reportIndex + 1]) throw new Error('Provide a report path.');
  await writeFile(process.argv[reportIndex + 1], JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ roots: roots.map(({ id, label, email, active }) => ({ id, label, email, active })), summary: report.summary, visibleFolders: report.visibleFolders, outsideTreeReferences: missing }, null, 2));
