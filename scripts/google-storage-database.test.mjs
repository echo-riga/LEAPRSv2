import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq, sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
process.env.GOOGLE_CLIENT_ID = 'simulation-client';
process.env.GOOGLE_CLIENT_SECRET = 'simulation-secret';
process.env.GOOGLE_STORAGE_ENCRYPTION_KEY = 'simulation-encryption-key-for-tests-only';
process.env.APP_URL = 'https://leaprs.test';
delete process.env.GOOGLE_REFRESH_TOKEN;
delete process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
const context = new AsyncLocalStorage();
globalThis.googleStorageTestContext = context;
const stub = 'data:text/javascript,' + encodeURIComponent('export const db = new Proxy({}, { get(_,key) { const db=globalThis.googleStorageTestContext.getStore(); const fn=db[key]; return typeof fn === "function" ? fn.bind(db) : fn; } });');
registerHooks({ resolve(specifier, ctx, next) {
  if (specifier === '@/db') return { url: stub, shortCircuit: true };
  if (specifier === '@/db/transaction') return { url: 'data:text/javascript,export const withTransaction = run => globalThis.googleStorageTestTransaction(run)', shortCircuit: true };
  return next(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const storage = await import('../src/lib/google-storage.ts');
const oauth = await import('../src/lib/google-storage-oauth.ts');
const { encryptGoogleSecret, decryptGoogleSecret } = await import('../src/lib/google-storage-crypto.ts');
const { claimRequestFolder } = await import('../src/lib/request-storage.ts');
const { googleStorageConnections, googleStorageMigrations, googleStorageMigrationItems, auditLogs } = await import('../src/db/schema.ts');
const migration = await import('../src/lib/google-storage-migration.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = 'google_storage_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + schema + '"';
async function transaction(run) {
  return drizzle(pool).transaction(async tx => {
    await tx.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
    return context.run(tx, () => run(tx));
  });
}
globalThis.googleStorageTestTransaction = transaction;
const source = readFileSync(new URL('../src/app/api/google-storage/callback/route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('callback.ts', source, ts.ScriptTarget.Latest, true);
const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GET');
const callbackCode = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

test('Google storage switching uses disposable database tables and a local HTTP provider', async t => {
  const server = fork(new URL('../postman/mocks/google-storage/default.js', import.meta.url), [], { env: { ...process.env, PORT: '0' }, silent: true });
  const [{ port }] = await once(server, 'message');
  const base = 'http://127.0.0.1:' + port;
  process.env.GOOGLE_STORAGE_DRIVE_API_URL = base;
  process.env.GOOGLE_STORAGE_TOKEN_URL = base + '/token';
  const reset = fixture => fetch(base + '/__reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture) });
  const state = async () => (await fetch(base + '/__state')).json();
  const callback = async ({ code = 'valid', tamper = false } = {}) => {
    const { cookie, flow } = oauth.createGoogleStorageFlow('admin', 'https://leaprs.test/api/google-storage/callback');
    let cleared = false;
    const deps = { cookies: async () => ({ get: () => ({ value: cookie }), set: (_name, _value, opts) => { cleared = opts.maxAge === 0 && opts.path === '/api/google-storage'; } }),
      requireGoogleStorageAdmin: async () => ({ userId: 'admin', name: 'Admin', role: 'admin' }),
      ...oauth, ...storage, ...migration, encryptGoogleSecret, withTransaction: transaction, googleStorageConnections, googleStorageMigrations, auditLogs, eq, sql, randomUUID,
      storageResponseHeaders: { 'Cache-Control': 'private, no-store' }, NextResponse: { redirect: (url, opts) => new Response(null, { ...opts, headers: { ...opts.headers, location: String(url) } }) } };
    const GET = new Function(...Object.keys(deps), callbackCode + '; return GET;')(...Object.values(deps));
    const response = await GET(new Request('https://leaprs.test/api/google-storage/callback?code=' + code + '&state=' + (tamper ? 'wrong' : flow.state)));
    assert.equal(cleared, true);
    return new URL(response.headers.get('location')).searchParams.get('storage');
  };
  try {
    await pool.query('CREATE SCHEMA ' + quoted);
    for (const name of ['google_storage_connections', 'google_drive_resources', 'request_storage_folders', 'requests', 'audit_logs']) {
      await pool.query('CREATE TABLE ' + quoted + '."' + name + '" (LIKE public."' + name + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
    }
    await transaction(async tx => {
      for (const statement of readFileSync(new URL('../drizzle/0025_google_storage_migrations.sql', import.meta.url), 'utf8').split(';').map(value => value.trim()).filter(Boolean)) {
        await tx.execute(sql.raw(statement));
      }
    });
    await pool.query('CREATE SEQUENCE ' + quoted + '.audit_id');
    await pool.query('ALTER TABLE ' + quoted + ".audit_logs ALTER COLUMN id SET DEFAULT nextval('" + schema + ".audit_id')");
    await transaction(async tx => {
      await tx.insert(googleStorageConnections).values({ id: 'old', accountId: 'legacy:old-root', email: 'Previous storage account', rootFolderId: 'old-root', encryptedRefreshToken: encryptGoogleSecret('old-refresh'), isActive: true, isLegacy: true });
      await tx.execute(sql`INSERT INTO request_storage_folders(folder_id,request_id,user_id,root_folder_id) VALUES ('old-request-folder',10,'owner','old-root')`);
    });
    await t.test('legacy owner email is retrieved from Google once and cached without exposing credentials', async () => {
      await reset({});
      await transaction(async () => {
        assert.deepEqual(await storage.getCurrentGoogleStorageOwner(), {email:'storage@example.test'});
        assert.deepEqual(await storage.getCurrentGoogleStorageOwner(), {email:'storage@example.test'});
      });
      assert.deepEqual((await state()).refreshes,['old-refresh']);
    });
    await t.test('failed Google authorization and forged state preserve the original active account', async () => {
      await reset({});
      assert.equal(await callback({ tamper: true }), 'connection_failed');
      assert.equal(await callback({ code: 'expired' }), 'connection_failed');
      await reset({ mode: 'error' });
      assert.equal(await callback(), 'connection_failed');
      await transaction(async () => assert.equal((await storage.getActiveGoogleStorage()).rootFolderId, 'old-root'));
    });
    await t.test('concurrent authorizations activate one root; reconnects reuse it', async () => {
      await reset({});
      assert.deepEqual(await Promise.all([callback(), callback()]), ['connected', 'connected']);
      assert.equal((await state()).creates, 1);
      await transaction(async tx => {
        const rows = await tx.select().from(googleStorageConnections);
        assert.equal(rows.filter(row => row.isActive).length, 1);
        assert.equal(rows.length, 2);
        assert.equal(decryptGoogleSecret(rows.find(row => row.isActive).encryptedRefreshToken), 'sim-refresh');
        assert.equal(decryptGoogleSecret(rows.find(row => row.id === 'old').encryptedRefreshToken), 'old-refresh');
      });
      assert.equal(await callback(), 'connected');
      assert.equal((await state()).creates, 1);
    });
    await t.test('old files/forms and request-folder ownership survive switching and removal of legacy env vars', async () => {
      await transaction(async tx => {
        const active = await storage.getActiveGoogleStorage();
        assert.notEqual(active.rootFolderId, 'old-root');
        assert.equal(await storage.getGoogleResourceRoot('old-unregistered-form'), 'old-root');
        await storage.registerGoogleResource('new-file', active.rootFolderId);
        assert.equal(await storage.getGoogleResourceRoot('new-file'), active.rootFolderId);
        await assert.rejects(storage.registerGoogleResource('new-file', 'old-root'), /ownership/);
        await tx.execute(sql`INSERT INTO request_storage_folders(folder_id,request_id,user_id,root_folder_id) VALUES ('new-request-folder',10,'owner',${active.rootFolderId})`);
        const data = { googleDriveFolderId: 'old-request-folder' };
        await claimRequestFolder(tx, 'owner', 10, data);
        assert.equal(data.googleDriveFolderId, 'old-request-folder');
        await assert.rejects(claimRequestFolder(tx, 'stranger', 99, { googleDriveFolderId: 'old-request-folder' }), /permission/);
        await storage.getGoogleStorageToken(await storage.getGoogleStorageForRoot(await storage.getGoogleResourceRoot('old-unregistered-form')));
        assert.equal((await state()).refreshes.at(-1), 'old-refresh');
      });
    });
    await t.test('an in-flight upload is located by its tagged root rather than the first account that can see it', async () => {
      await transaction(async () => {
        const active = await storage.getActiveGoogleStorage();
        const fixture = await state();
        fixture.folders.push({ id: 'in-flight-file', name: 'attachment.pdf', mimeType: 'application/pdf', size: '123', parents: ['new-request-folder'], appProperties: { leaprsStorageRoot: active.rootFolderId } });
        await reset(fixture);
        const found = await storage.findGoogleUpload('in-flight-file');
        assert.equal(found.storage.rootFolderId, active.rootFolderId);
      });
    });
    await t.test('durable migration discovers, transfers, verifies, and resolves old resource roots to the new owner', async () => {
      await transaction(async tx => {
        const active = await storage.getActiveGoogleStorage();
        await tx.update(googleStorageConnections).set({ encryptedRefreshToken: encryptGoogleSecret('target-refresh'), accountId: 'target-account' }).where(eq(googleStorageConnections.id, active.id));
      });
      const root = { id: 'old-root', name: 'Previous LEAPRS', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], owners: [{ permissionId: 'source-account' }] };
      const attachment = { id: 'old-attachment', name: 'original.pdf', mimeType: 'application/pdf', parents: ['old-root'], owners: [{ permissionId: 'source-account' }] };
      await reset({ migration: true, files: [root, attachment], blocked: true });
      let status;
      for (let i = 0; i < 6; i++) {
        status = await transaction(() => migration.advanceStorageMigration());
        if (status?.status === 'failed') break;
      }
      assert.equal(status.status, 'failed');
      assert.equal(status.completed, 0);
      assert.match(status.error, /Google blocked/);
      await transaction(async tx => {
        await migration.retargetFailedStorageMigrations(tx, 'replacement-root');
        const [rerouted] = await tx.select().from(googleStorageMigrations);
        assert.equal(rerouted.targetRoot, 'replacement-root');
        assert.equal(rerouted.status, 'running');
        await assert.rejects(migration.retargetFailedStorageMigrations(tx, 'another-root'), /Finish the current/);
        // Restore the failed destination to exercise retry below.
        await tx.update(googleStorageMigrations).set({ targetRoot: 'sim-folder-1', status: 'failed' }).where(eq(googleStorageMigrations.id, rerouted.id));
      });
      const blockedCalls = (await state()).permissionCalls;
      await transaction(() => migration.advanceStorageMigration());
      assert.equal((await state()).permissionCalls, blockedCalls);
      await transaction(async tx => { await assert.rejects(migration.assertStorageMigrationIdle(tx), /Finish the current/); });
      await reset({ migration: true, files: [root, attachment], lostResponse: true });
      for (let i = 0; i < 40; i++) {
        status = await transaction(() => migration.advanceStorageMigration(true));
        if (status?.status === 'completed') break;
      }
      assert.equal(status.status, 'completed');
      assert.equal(status.completed, 2);
      assert.equal(status.total, 2);
      assert.equal((await state()).transfers, 2);
      await transaction(async () => {
        const resolved = await storage.getGoogleStorageForRoot('old-root');
        assert.equal(resolved.rootFolderId, 'old-root');
        assert.equal(decryptGoogleSecret(resolved.encryptedRefreshToken), 'target-refresh');
      });
      const late = { ...attachment, id: 'late-upload' };
      const fixture = await state();
      fixture.files.push(late);
      await reset(fixture);
      await transaction(() => storage.registerGoogleResource('late-upload', 'old-root'));
      status = await transaction(() => migration.getStorageMigrationStatus());
      assert.equal(status.status, 'running');
      for (let i = 0; i < 30; i++) {
        status = await transaction(() => migration.advanceStorageMigration());
        if (status?.status === 'completed') break;
      }
      assert.equal(status.status, 'completed');
      assert.equal(status.completed, 3);
      assert.equal((await state()).transfers, 3);
      await transaction(async tx => {
        assert.equal((await tx.select().from(googleStorageMigrationItems)).length, 3);
      });
    });
    await t.test('older retained roots are queued once and unfinished progress takes priority over completed history', async () => {
      await transaction(async tx => {
        const active = await storage.getActiveGoogleStorage();
        const [older] = await tx.insert(googleStorageConnections).values({ id: 'older', accountId: 'source-account', email: 'source-account@example.test',
          rootFolderId: 'older-root', encryptedRefreshToken: encryptGoogleSecret('old-refresh') }).returning();
        await migration.queueStorageMigration(tx, older, active.rootFolderId);
        await migration.queueStorageMigration(tx, older, active.rootFolderId);
        assert.equal((await tx.select().from(googleStorageMigrations)).length, 2);
      });
      const status = await transaction(() => migration.getStorageMigrationStatus());
      assert.equal(status.status, 'running');
      assert.equal(status.total, 1);
      assert.equal(status.completed, 0);
      const fixture = await state();
      fixture.files.push({ id: 'older-root', name: 'Older LEAPRS', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], owners: [{ permissionId: 'source-account' }] });
      await reset(fixture);
      let finished;
      for (let i = 0; i < 15; i++) {
        finished = await transaction(() => migration.advanceStorageMigration());
        if (finished?.status === 'completed') break;
      }
      assert.equal(finished.status, 'completed');
      await transaction(async () => {
        assert.equal(decryptGoogleSecret((await storage.getGoogleStorageForRoot('older-root')).encryptedRefreshToken), 'target-refresh');
      });
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
    server.kill();
    delete globalThis.googleStorageTestContext;
    delete globalThis.googleStorageTestTransaction;
  }
});
