import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.GOOGLE_CLIENT_ID = 'simulation-client';
process.env.GOOGLE_CLIENT_SECRET = 'simulation-secret';
process.env.GOOGLE_STORAGE_ENCRYPTION_KEY = 'simulation-encryption-key-for-tests-only';
process.env.APP_URL = 'https://leaprs.test';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/db') return { url: 'data:text/javascript,export const db = {}', shortCircuit: true };
  return next(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, context);
} });
const { encryptGoogleSecret, decryptGoogleSecret } = await import('../src/lib/google-storage-crypto.ts');
const { createGoogleStorageFlow, verifyGoogleStorageFlow, findOrCreateGoogleRoot } = await import('../src/lib/google-storage-oauth.ts');
const { googleTokenRequest } = await import('../src/lib/google-storage.ts');
const { ownerFilesFolderName } = await import('../src/lib/google-storage-folder-name.ts');

const server = fork(new URL('../postman/mocks/google-storage/default.js', import.meta.url), [], { env: { ...process.env, PORT: '0' }, silent: true });
after(() => server.kill());
const [{ port }] = await once(server, 'message');
const base = 'http://127.0.0.1:' + port;
process.env.GOOGLE_STORAGE_DRIVE_API_URL = base;
process.env.GOOGLE_STORAGE_TOKEN_URL = base + '/token';
const reset = async fixture => { assert.equal((await fetch(base + '/__reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture) })).status, 200); };
const state = async () => (await fetch(base + '/__state')).json();
const folder = (id, extra = {}) => ({ id, name: 'LEAPRS', mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, capabilities: { canAddChildren: true }, ...extra });

test('Google credentials are encrypted and tampering is rejected', () => {
  const encrypted = encryptGoogleSecret('refresh-token-example');
  assert.ok(!encrypted.includes('refresh-token-example'));
  assert.equal(decryptGoogleSecret(encrypted), 'refresh-token-example');
  const parts = encrypted.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptGoogleSecret(parts.join('.')));
});

test('OAuth flow binds state, the initiating Admin, callback address, and expiry', () => {
  const { cookie, flow, challenge } = createGoogleStorageFlow('admin-a', 'https://leaprs.test/api/google-storage/callback');
  assert.ok(challenge);
  assert.equal(verifyGoogleStorageFlow(cookie, flow.state, 'admin-a').verifier, flow.verifier);
  assert.throws(() => verifyGoogleStorageFlow(cookie, 'wrong-state', 'admin-a'));
  assert.throws(() => verifyGoogleStorageFlow(cookie, flow.state, 'admin-b'));
  assert.throws(() => verifyGoogleStorageFlow(encryptGoogleSecret(JSON.stringify({ ...flow, expiresAt: 0 })), flow.state, 'admin-a'));
  process.env.APP_URL = 'https://changed.test';
  assert.throws(() => verifyGoogleStorageFlow(cookie, flow.state, 'admin-a'));
  process.env.APP_URL = 'https://leaprs.test';
});

test('storage root labels use the owner name with an email fallback', () => {
  assert.equal(ownerFilesFolderName({ displayName: '  Jericho   Riga  ', emailAddress: 'owner@example.test' }), "Jericho Riga's files");
  assert.equal(ownerFilesFolderName({ emailAddress: 'owner@example.test' }), "owner@example.test's files");
  assert.equal(ownerFilesFolderName({ displayName: 'Jericho Riga', emailAddress: 'owner@example.test' }, true), "Jericho Riga's files (owner@example.test)");
});

test('real HTTP authorization creates one folder and reconnects reuse it even after rename', async () => {
  await reset({});
  const tokens = await googleTokenRequest({ grant_type: 'authorization_code', code: 'valid', redirect_uri: 'https://leaprs.test/api/google-storage/callback', code_verifier: 'test-verifier' });
  const root = await findOrCreateGoogleRoot(tokens.access_token);
  assert.equal((await state()).creates, 1);
  assert.equal((await state()).folders[0].name, "Storage Owner's files");
  assert.equal(await findOrCreateGoogleRoot(tokens.access_token), root);
  const fixture = await state(); fixture.folders[0].name = 'Renamed by owner';
  await reset(fixture);
  assert.equal(await findOrCreateGoogleRoot(tokens.access_token, root), root);
  assert.equal((await state()).creates, 1);
});

test('real HTTP setup adopts a single owned existing folder and refuses ambiguous names', async () => {
  await reset({ folders: [folder('existing')] });
  assert.equal(await findOrCreateGoogleRoot('sim-access'), 'existing');
  assert.equal((await state()).creates, 0);
  assert.equal((await state()).patches, 1);
  assert.equal((await state()).folders[0].name, "Storage Owner's files");
  await reset({ folders: [folder('a'), folder('b')] });
  await assert.rejects(findOrCreateGoogleRoot('sim-access'), /Multiple LEAPRS/);
  assert.equal((await state()).creates, 0);
});

test('unowned folders are not adopted; Google failures propagate without inventing a root', async () => {
  await reset({ folders: [folder('shared', { ownedByMe: false })] });
  assert.notEqual(await findOrCreateGoogleRoot('sim-access'), 'shared');
  await reset({ mode: 'error' });
  await assert.rejects(findOrCreateGoogleRoot('sim-access'), /Unable to find/);
  assert.equal((await state()).creates, 0);
  await assert.rejects(googleTokenRequest({ grant_type: 'authorization_code', code: 'expired' }), /authorization failed/);
});

test('storage administration rejects every non-Admin and signed-out access', async () => {
  const source = readFileSync(new URL('../src/lib/google-storage-admin.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('admin.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requireGoogleStorageAdmin');
  const code = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  for (const role of [null, 'employee', 'employee-department', 'viewer', 'viewer-full']) {
    const requireAdmin = new Function('getCurrentUserAccess', code + '; return requireGoogleStorageAdmin;')(async () => role ? { success: true, role } : { success: false });
    await assert.rejects(requireAdmin(), /Administrator/);
  }
});
