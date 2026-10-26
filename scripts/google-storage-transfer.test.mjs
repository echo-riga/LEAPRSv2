import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/db') return { url: 'data:text/javascript,export const db = {}', shortCircuit: true };
  return next(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, context);
} });
const { transferDriveOwnership, listTransferChildren, finishTransferredRoot } = await import('../src/lib/google-storage-transfer-drive.ts');
const server = fork(new URL('../postman/mocks/google-storage/default.js', import.meta.url), [], { env: { ...process.env, PORT: '0' }, silent: true });
after(() => server.kill());
const [{ port }] = await once(server, 'message');
const base = 'http://127.0.0.1:' + port;
process.env.GOOGLE_STORAGE_DRIVE_API_URL = base;
const file = (id, extra = {}) => ({ id, name: id, mimeType: 'application/pdf', parents: ['old-root'], owners: [{ permissionId: 'source-account' }], ...extra });
const reset = fixture => fetch(base + '/__reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ migration: true, files: [file('attachment')], ...fixture }) });
const state = async () => (await fetch(base + '/__state')).json();
const transfer = (extra = {}) => transferDriveOwnership({ fileId: 'attachment', sourceToken: 'sim-source', targetToken: 'sim-target', targetAccountId: 'target-account', targetEmail: 'target-account@example.test', ...extra });

test('consumer transfer preserves file ID, parents, and existing Form data', async () => {
  await reset({ files: [file('attachment', { mimeType: 'application/vnd.google-apps.form', responses: [{ responseId: 'existing-response' }] })] });
  const result = await transfer();
  assert.equal(result.id, 'attachment');
  assert.deepEqual(result.parents, ['old-root']);
  assert.equal((await state()).files[0].responses[0].responseId, 'existing-response');
  assert.equal((await state()).transfers, 1);
  assert.equal((await state()).shares, 1);
  assert.equal((await state()).pendingUpdates, 1);
});

test('same-organization Workspace accounts use direct ownership transfer', async () => {
  await reset({ workspace: true });
  assert.equal((await transfer()).ownedByMe, true);
  assert.equal((await state()).transfers, 1);
});

test('retrying an existing Editor share explicitly requests pending ownership', async () => {
  await reset({ files: [file('attachment', { permissions: [{ id: 'target-account', emailAddress: 'target-account@example.test', role: 'writer' }] })] });
  assert.equal((await transfer()).ownedByMe, true);
  const fixture = await state();
  assert.equal(fixture.shares || 0, 0);
  assert.equal(fixture.pendingUpdates, 1);
});

test('a lost transfer response is recovered without another ownership invitation', async () => {
  await reset({ lostResponse: true });
  await assert.rejects(transfer(), /could not accept pending ownership.*HTTP 503/);
  const calls = (await state()).permissionCalls;
  assert.equal((await transfer()).ownedByMe, true);
  assert.equal((await state()).permissionCalls, calls);
  assert.equal((await state()).transfers, 1);
});

test('blocked transfers preserve the original file and report account restrictions', async () => {
  await reset({ blocked: true });
  await assert.rejects(transfer(), /ownershipChangeAcrossDomainsNotPermitted/);
  assert.equal((await state()).files[0].owners[0].permissionId, 'source-account');
  assert.equal((await state()).transfers || 0, 0);
});

test('a generic permissions rejection does not claim the accounts are incompatible', async () => {
  await reset({ blocked: true, blockedReason: 'insufficientFilePermissions' });
  await assert.rejects(transfer(), error => {
    assert.match(error.message, /insufficientFilePermissions/);
    assert.doesNotMatch(error.message, /organizations|incompatible/);
    return true;
  });
});

test('rate limiting on pending ownership does not attempt a direct ownership transfer', async () => {
  await reset({ pendingFailureReason: 'userRateLimitExceeded' });
  await assert.rejects(transfer(), /temporarily limited.*userRateLimitExceeded/);
  const fixture = await state();
  assert.equal(fixture.permissionCalls, 3);
  assert.equal(fixture.transfers || 0, 0);
});

test('discovery follows provider pagination without losing files', async () => {
  await reset({ files: ['a', 'b', 'c'].map(id => file(id)) });
  const first = await listTransferChildren('sim-source', 'old-root');
  assert.deepEqual(first.files.map(value => value.id), ['a', 'b']);
  const second = await listTransferChildren('sim-source', 'old-root', first.nextPageToken);
  assert.deepEqual(second.files.map(value => value.id), ['c']);
  assert.equal(second.nextPageToken, undefined);
});

test('finishing a root moves its existing tree and is safe to repeat', async () => {
  await reset({ files: [file('old-root', { mimeType: 'application/vnd.google-apps.folder', parents: ['root'], owners: [{ permissionId: 'target-account' }], appProperties: { leaprsClient: 'existing-client' } })] });
  await finishTransferredRoot('old-root', 'new-root', 'sim-target');
  await finishTransferredRoot('old-root', 'new-root', 'sim-target');
  const root = (await state()).files[0];
  assert.deepEqual(root.parents, ['new-root']);
  assert.equal(root.appProperties.leaprsStorageRoot, 'migrated');
  assert.equal(root.appProperties.leaprsClient, 'existing-client');
});
