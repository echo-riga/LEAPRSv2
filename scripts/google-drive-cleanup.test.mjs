import assert from 'node:assert/strict';
import test from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import ts from 'typescript';

process.loadEnvFile('.env.local');
process.env.GOOGLE_CLIENT_ID = 'simulation-client';
process.env.GOOGLE_CLIENT_SECRET = 'simulation-secret';
process.env.GOOGLE_STORAGE_ENCRYPTION_KEY = 'cleanup-test-encryption-key-only-32-characters';
delete process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
delete process.env.GOOGLE_REFRESH_TOKEN;
const context = new AsyncLocalStorage();
globalThis.driveCleanupTestContext = context;
const proxy = 'data:text/javascript,' + encodeURIComponent('export const db = new Proxy({}, {get(_,key){const db=globalThis.driveCleanupTestContext.getStore(); const value=db[key]; return typeof value === "function" ? value.bind(db) : value;}})');
registerHooks({ resolve(specifier, ctx, next) {
  if (specifier === '@/db') return { url: proxy, shortCircuit: true };
  if (specifier === '@/db/transaction') return { url: 'data:text/javascript,export const withTransaction = run => globalThis.driveCleanupTestTransaction(run)', shortCircuit: true };
  return next(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const cleanup = await import('../src/lib/drive-cleanup.ts');
const { db: scopedDb } = await import('@/db');
const lifecycle = await import('../src/lib/drive-attachment-lifecycle.ts');
const storage = await import('../src/lib/google-storage.ts');
const { encryptGoogleSecret } = await import('../src/lib/google-storage-crypto.ts');
const { auditChanges, requestLabel } = await import('../src/lib/audit-description.ts');
const { validateMoney, validateRequestInput } = await import('../src/lib/request-validation.ts');
const { claimRequestFolder } = await import('../src/lib/request-storage.ts');
const { deleteRequestRecords } = await import('../src/lib/request-deletion.ts');
const { isArchiveReadOnly } = await import('../src/lib/archive-policy.ts');
const { capdevs, requests, requestStatusUpdates, requestStorageFolders, auditLogs, googleStorageConnections, googleStorageMigrations, googleDriveResources, googleDriveCleanupJobs: jobs } = await import('../src/db/schema.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = 'drive_cleanup_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + schema + '"';
async function transaction(run) {
  return drizzle(pool).transaction(async tx => {
    await tx.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
    return context.run(tx, () => run(tx));
  });
}
globalThis.driveCleanupTestTransaction = transaction;
const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateCapdev');
const code = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const deps = {
  ...lifecycle, db: scopedDb, withTransaction: transaction, ...storage, validateMoney, auditChanges, capdevs, eq,
  getCurrentAccess: async () => ({ userId: 'admin', role: 'admin' }), unauthorized: { success: false, error: 'Denied' },
  validatePendingAttachments: value => value, validateComboboxValues: async () => null, getMissingRequiredCapdevFields: async () => [],
  lockCapdevFolder: async () => {}, reconcilePendingAttachments: value => value, ARCHIVED_READ_ONLY: 'Archived',
  getCapdevFieldDefinitions: async () => [], getDynamicFieldValue: () => undefined, writeAuditLog: async () => {}, scheduleDriveCleanup: () => {},
};
const updateCapdev = new Function(...Object.keys(deps), code + '; return updateCapdev;')(...Object.values(deps));
const scopedRequest = async (_access, id) => (await scopedDb.select().from(requests).where(eq(requests.id, id)))[0];
const requestDeps = { ...deps, requests, requestStatusUpdates, requestStorageFolders, auditLogs, and, inArray, or, sql,
  requestLabel,
  validateRequestInput, claimRequestFolder, deleteRequestRecords, isArchiveReadOnly,
  canManageRequests: () => true, getWritableRequest: scopedRequest, getAccessibleRequest: scopedRequest,
  getActorSnapshot: async () => ({ actorId: 'admin', actorName: 'Admin', actorEmail: null }),
  assertActiveFolderAccess: async () => {}, hasRequiredValue: () => true,
  getRequestFormSchemaService: async () => ({ dynamicFields: [] }),
};
function action(name, dependencies) {
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const code = ts.transpileModule(node.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), code + '; return ' + name + ';')(...Object.values(dependencies));
}
const updateRequest = action('updateRequest', requestDeps);
const deleteProgress = action('deleteRequestStatusUpdate', requestDeps);
const deleteRequest = action('deleteRequest', { ...requestDeps, cleanupRequestStorage: action('cleanupRequestStorage', requestDeps) });
const attachment = id => ({ id, name: id + '.pdf', mimeType: 'application/pdf', url: 'https://drive.google.com/open?id=' + id });
const root = { id: 'cleanup-root', name: "Owner's files", mimeType: 'application/vnd.google-apps.folder', parents: ['root'], owners: [{ permissionId: 'source-account' }] };
const file = (id = 'file-one', extra = {}) => ({ id, name: id + '.pdf', mimeType: 'application/pdf', parents: ['cleanup-root'],
  owners: [{ permissionId: 'source-account' }], createdTime: '2020-01-01T00:00:00Z', appProperties: { leaprsStorageRoot: 'cleanup-root' }, ...extra });

test('Drive lifecycle cleanup uses disposable database tables and the real HTTP client', async t => {
  const server = fork(new URL('../postman/mocks/google-storage/default.js', import.meta.url), [], { env: { ...process.env, PORT: '0' }, silent: true });
  const [{ port }] = await once(server, 'message');
  const base = 'http://127.0.0.1:' + port;
  process.env.GOOGLE_STORAGE_DRIVE_API_URL = base;
  process.env.GOOGLE_STORAGE_TOKEN_URL = base + '/token';
  const state = async () => (await fetch(base + '/__state')).json();
  const reset = async (extra = {}) => {
    await transaction(async tx => {
      await tx.execute(sql`DELETE FROM request_status_updates`);
      await tx.execute(sql`DELETE FROM requests`);
      await tx.execute(sql`DELETE FROM request_storage_folders`);
      await tx.execute(sql`DELETE FROM capdevs`);
      await tx.execute(sql`DELETE FROM google_drive_resources`);
      await tx.execute(sql`DELETE FROM google_drive_cleanup_jobs`);
      await tx.execute(sql`DELETE FROM google_drive_cleanup_scans`);
      await tx.execute(sql`DELETE FROM google_storage_migrations`);
      await tx.execute(sql`DELETE FROM google_storage_connections WHERE id <> 'cleanup-connection'`);
      await tx.insert(googleDriveResources).values({ fileId: 'file-one', rootFolderId: 'cleanup-root' });
    });
    await fetch(base + '/__reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ migration: true, files: [root, file()], ...extra }) });
  };
  const project = async (id, info) => transaction(tx => tx.insert(capdevs).values({ id, folderId: 1, aipCode: '2026-001-1-1-01-001-001',
    description: '', department: 'Test', updatedById: 'admin', initialBudget: '100', budget: '100', additionalInfo: info }));
  const save = (id, info) => transaction(() => updateCapdev(id, { folderId: 1, aipCode: '2026-001-1-1-01-001-001', description: '', department: 'Test', additionalInfo: info }));
  const job = id => transaction(async tx => (await tx.select().from(jobs).where(eq(jobs.fileId, id)))[0]);
  const processOne = async () => {
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      result = await transaction(() => cleanup.processDriveCleanup(1));
      if (result.processed) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return result;
  };
  const request = (extra = {}) => transaction(tx => tx.insert(requests).values({ id: 1, capdevId: 1, userId: 'admin',
    updatedById: 'admin', setting: 'internal', description: 'Test request', eventDate: '2026-10-26', requestedBudget: '10', ...extra }));
  try {
    await pool.query('CREATE SCHEMA ' + quoted);
    for (const table of ['google_storage_connections', 'google_drive_resources', 'request_storage_folders', 'capdevs', 'requests', 'request_status_updates', 'capdev_folders', 'audit_logs']) {
      await pool.query('CREATE TABLE ' + quoted + '."' + table + '" (LIKE public."' + table + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
    }
    await pool.query('CREATE SEQUENCE ' + quoted + '.audit_id');
    await pool.query('ALTER TABLE ' + quoted + ".audit_logs ALTER COLUMN id SET DEFAULT nextval('" + schema + ".audit_id')");
    await transaction(async tx => {
      for (const migration of ['0025_google_storage_migrations.sql', '0026_google_drive_cleanup.sql']) {
        for (const statement of readFileSync(new URL('../drizzle/' + migration, import.meta.url), 'utf8').split(';').map(value => value.trim()).filter(Boolean)) await tx.execute(sql.raw(statement));
      }
      await tx.insert(googleStorageConnections).values({ id: 'cleanup-connection', accountId: 'source-account', email: 'source@example.test',
        rootFolderId: 'cleanup-root', encryptedRefreshToken: encryptGoogleSecret('source-refresh'), isActive: true, isLegacy: true });
    });
    await t.test('actual CapDev attachment edits protect shared files and delete after the last reference is removed', async () => {
      await reset();
      await project(1, { files: [attachment('file-one')] });
      await project(2, { files: [attachment('file-one')] });
      assert.equal((await save(1, {})).success, true);
      assert.equal((await job('file-one')).status, 'pending');
      await processOne();
      assert.equal((await job('file-one')).status, 'retained');
      assert.deepEqual((await state()).deleted || [], []);
      assert.equal((await save(2, {})).success, true);
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
      assert.deepEqual((await state()).deleted, ['file-one']);
    });
    await t.test('a failed record transaction rolls back both reference removal and its deletion job', async () => {
      await reset();
      await project(1, { files: [attachment('file-one')] });
      await assert.rejects(transaction(async tx => {
        await lifecycle.lockDriveAttachments(tx);
        await tx.update(capdevs).set({ additionalInfo: {} }).where(eq(capdevs.id, 1));
        await lifecycle.enqueueRemovedAttachments(tx, { files: [attachment('file-one')] }, {});
        throw new Error('save failed');
      }), /save failed/);
      assert.equal(await job('file-one'), undefined);
      await transaction(async tx => assert.equal((await tx.select().from(capdevs))[0].additionalInfo.files[0].id, 'file-one'));
      assert.deepEqual((await state()).deleted || [], []);
    });
    await t.test('actual request edits enqueue removed attachments after saving', async () => {
      await reset();
      await project(1, {});
      await request({ additionalInfo: { files: [attachment('file-one')] } });
      const result = await transaction(() => updateRequest(1, { capdevId: 1, setting: 'internal', description: 'Updated', eventDate: '2026-10-26', requestedBudget: '10', additionalInfo: {} }));
      assert.equal(result.success, true);
      assert.equal((await job('file-one')).status, 'pending');
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
    });
    await t.test('deleting a stopper and its responses queues their files while preserving a file used by another progress update', async () => {
      await reset({ files: [root, file(), file('file-two')] });
      await transaction(tx => tx.insert(googleDriveResources).values({ fileId: 'file-two', rootFolderId: 'cleanup-root' }));
      await project(1, {});
      await request({ isStopped: true, activeStopperId: 1 });
      await transaction(tx => tx.insert(requestStatusUpdates).values([
        { id: 1, requestId: 1, userId: 'admin', statusUpdate: 'Stopper', isStopper: true, archivedAt: new Date(), files: [attachment('file-one')] },
        { id: 2, requestId: 1, userId: 'admin', statusUpdate: 'Response', stopperId: 1, files: [attachment('file-two')] },
        { id: 3, requestId: 1, userId: 'admin', statusUpdate: 'Retained', files: [attachment('file-one')] },
      ]));
      assert.equal((await transaction(() => deleteProgress(1))).success, true);
      await processOne();
      await processOne();
      assert.equal((await job('file-one')).status, 'retained');
      assert.equal((await job('file-two')).status, 'deleted');
      await transaction(async tx => {
        assert.deepEqual((await tx.select().from(requestStatusUpdates)).map(row => row.id), [3]);
        assert.equal((await tx.select().from(requests))[0].activeStopperId, null);
        assert.equal(Number((await tx.select().from(capdevs))[0].budget), 100);
      });
    });
    await t.test('current evaluation forms outside the root are preserved, then deleted only with their archived request', async () => {
      await reset({ files: [root, file('form-one', { mimeType: 'application/vnd.google-apps.form', parents: [] })] });
      await transaction(tx => tx.insert(googleDriveResources).values({ fileId: 'form-one', rootFolderId: 'cleanup-root' }));
      await project(1, {});
      await request({ participantFeedbackFormId: 'form-one', archivedAt: new Date() });
      await transaction(tx => lifecycle.enqueueFileIds(tx, ['form-one'], 'form'));
      await processOne();
      assert.equal((await job('form-one')).status, 'retained');
      assert.equal((await transaction(() => deleteRequest(1))).success, true);
      await processOne();
      assert.equal((await job('form-one')).status, 'deleted');
      assert.deepEqual((await state()).deleted, ['form-one']);
    });
    await t.test('provider failures persist with backoff and retry deletes the same file once', async () => {
      await reset({ deleteFailures: 1 });
      await transaction(tx => lifecycle.enqueueFileIds(tx, ['file-one']));
      await processOne();
      assert.equal((await job('file-one')).status, 'failed');
      assert.match((await job('file-one')).lastError, /HTTP 503/);
      assert.equal((await processOne()).processed, 0);
      await transaction(() => cleanup.retryFailedDriveCleanup());
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
      assert.deepEqual((await state()).deleted, ['file-one']);
    });
    await t.test('cleanup waits for unfinished ownership transfers and resumes after completion', async () => {
      await reset();
      await transaction(async tx => {
        await lifecycle.enqueueFileIds(tx, ['file-one']);
        await tx.insert(googleStorageMigrations).values({ id: 'in-flight-transfer', sourceRoot: 'another-root', targetRoot: 'new-root', sourceConnectionId: 'retained' });
      });
      assert.equal((await processOne()).processed, 0);
      assert.equal((await job('file-one')).status, 'pending');
      assert.deepEqual((await state()).deleted || [], []);
      await transaction(tx => tx.update(googleStorageMigrations).set({ status: 'completed' }).where(eq(googleStorageMigrations.id, 'in-flight-transfer')));
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
    });
    await t.test('a lost deletion response recovers from 404 and stale edits cannot resurrect deleted attachments', async () => {
      await reset({ deleteLostResponse: true });
      await transaction(tx => lifecycle.enqueueFileIds(tx, ['file-one']));
      await processOne();
      assert.equal((await job('file-one')).status, 'failed');
      await transaction(() => cleanup.retryFailedDriveCleanup());
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
      assert.deepEqual((await state()).deleted, ['file-one']);
      await assert.rejects(transaction(tx => lifecycle.assertAttachmentsNotDeleted(tx, { files: [attachment('file-one')] })), /already removed/);
    });
    await t.test('cleanup finds a late upload still owned by the earlier retained account', async () => {
      await reset();
      await transaction(async tx => {
        await tx.insert(googleStorageConnections).values({ id: 'new-owner', accountId: 'target-account', email: 'target@example.test', rootFolderId: 'new-root', encryptedRefreshToken: encryptGoogleSecret('target-refresh') });
        await tx.insert(googleStorageMigrations).values({ id: 'finished-transfer', sourceRoot: 'cleanup-root', targetRoot: 'new-root', sourceConnectionId: 'cleanup-connection', status: 'completed' });
        await lifecycle.enqueueFileIds(tx, ['file-one']);
      });
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
      assert.deepEqual((await state()).deleted, ['file-one']);
    });
    await t.test('request folder cleanup checks shared children individually before deleting the empty folder', async () => {
      const folder = { ...root, id: 'request-folder', parents: ['cleanup-root'] };
      await reset({ files: [root, folder, file('file-one', { parents: ['request-folder'] })] });
      await project(1, { files: [attachment('file-one')] });
      await transaction(tx => lifecycle.enqueueDriveCleanup(tx, 'request-folder', 'cleanup-root', 'folder'));
      await processOne(); // enumerate children
      await processOne(); // keep referenced child
      assert.deepEqual((await state()).deleted || [], []);
      assert.equal((await save(1, {})).success, true);
      await processOne();
      await processOne();
      assert.deepEqual((await state()).deleted, ['file-one', 'request-folder']);
      await transaction(tx => tx.insert(jobs).values({ fileId: 'cleanup-root', rootFolderId: 'cleanup-root', nextAttemptAt: new Date(0) }));
      await processOne();
      assert.equal((await job('cleanup-root')).status, 'retained');
    });
    await t.test('pending uploads survive reconciliation; abandoned tagged uploads are cleaned after the grace period', async () => {
      await reset({ files: [root, file('file-one', { appProperties: { leaprsStorageRoot: 'cleanup-root', leaprsUploadId: 'pending-token' } }),
        file('untagged-old-file', { appProperties: {} }), file('new-file', { createdTime: '2099-01-01T00:00:00Z' })] });
      await project(1, { uploads: [{ pending: true, pendingUploadId: 'pending-token', name: 'one.pdf' }] });
      await transaction(tx => lifecycle.enqueueFileIds(tx, ['file-one']));
      await processOne();
      assert.equal((await job('file-one')).status, 'retained');
      await transaction(() => cleanup.discoverUnreferencedDriveUploads());
      assert.equal((await job('file-one')).status, 'retained');
      assert.equal((await save(1, {})).success, true);
      await transaction(() => cleanup.discoverUnreferencedDriveUploads());
      await processOne();
      assert.equal((await job('file-one')).status, 'deleted');
      assert.equal(await job('untagged-old-file'), undefined);
      assert.equal(await job('new-file'), undefined);
    });
    await t.test('the scheduled cleanup endpoint rejects missing or incorrect credentials before any mutation', async () => {
      const routeSource = readFileSync(new URL('../src/app/api/google-storage/cleanup/route.ts', import.meta.url), 'utf8');
      const routeAst = ts.createSourceFile('route.ts', routeSource, ts.ScriptTarget.Latest, true);
      const node = routeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GET');
      const code = ts.transpileModule(node.getText(routeAst).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      let calls = 0;
      const routeDeps = { timingSafeEqual, storageResponseHeaders: {}, discoverUnreferencedDriveUploads: async () => { calls++; },
        processDriveCleanup: async () => { calls++; return {}; }, driveCleanupStatus: async () => ({}) };
      const get = new Function(...Object.keys(routeDeps), code + '; return GET;')(...Object.values(routeDeps));
      const previous = process.env.CRON_SECRET;
      process.env.CRON_SECRET = 'cleanup-test-secret';
      try {
        for (const authorization of ['', 'Bearer wrong-secret']) assert.equal((await get(new Request('https://leaprs.test/api/google-storage/cleanup', { headers: { authorization } }))).status, 401);
        assert.equal(calls, 0);
        assert.equal((await get(new Request('https://leaprs.test/api/google-storage/cleanup', { headers: { authorization: 'Bearer cleanup-test-secret' } }))).status, 200);
        assert.equal(calls, 2);
      } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
    server.kill();
    delete globalThis.driveCleanupTestTransaction;
    delete globalThis.driveCleanupTestContext;
  }
});
