import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, context);
} });
const { writeRequestStatusUpdate } = await import('../src/lib/request-budget.ts');
const { claimRequestFolder } = await import('../src/lib/request-storage.ts');
const { rateLimitStatement } = await import('../src/lib/security-rate-limit.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = 'security_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + schema + '"';
async function run(callback) {
  const client = await pool.connect();
  try {
    return await drizzle(client).transaction(async (tx) => {
      // Neon transaction pooling can switch backends between SET and BEGIN.
      // Bind the disposable schema inside the transaction itself.
      await tx.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
      const current = await tx.execute(sql`SELECT current_schema() AS schema`);
      assert.equal(current.rows[0].schema, schema);
      return callback(tx);
    });
  } finally { client.release(); }
}
const input = (requestId, overrides = {}) => ({ requestId, userId: 'owner', statusUpdate: 'Accepted',
  statusMark: 'accepted', subtractsRequestedAmount: true, files: [], additionalInfo: {}, ...overrides });

test('database security regression suite uses an isolated disposable schema', async (t) => {
  try {
    await pool.query('CREATE SCHEMA ' + quoted);
    for (const table of ['capdevs', 'requests', 'request_status_updates', 'request_storage_folders', 'security_rate_limits']) {
      await pool.query(`CREATE TABLE ${quoted}."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    }
    await pool.query(`CREATE SEQUENCE ${quoted}.status_id`);
    await pool.query(`ALTER TABLE ${quoted}.request_status_updates ALTER COLUMN id SET DEFAULT nextval('${schema}.status_id')`);
    const setup = async () => run(async (tx) => {
      await tx.execute(sql`TRUNCATE request_status_updates, request_storage_folders, requests, capdevs`);
      await tx.execute(sql`INSERT INTO capdevs (id,aip_code,initial_budget,budget,department,updated_by_id) VALUES (1,'TEST','10000','10000','Test','owner')`);
      await tx.execute(sql`INSERT INTO requests (id,capdev_id,user_id,setting,requested_budget,updated_by_id) VALUES (10,1,'owner','internal','7000','owner'),(20,1,'other','internal','7000','other')`);
    });
    await t.test('two requests cannot overspend the same balance', async () => {
      await setup();
      const results = await Promise.allSettled([run((tx) => writeRequestStatusUpdate(tx, 'admin', input(10))), run((tx) => writeRequestStatusUpdate(tx, 'admin', input(20)))]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const result = await run((tx) => tx.execute(sql`SELECT budget FROM capdevs WHERE id=1`));
      assert.equal(result.rows[0].budget, '3000.00');
    });
    await t.test('concurrent retries deduct a request only once', async () => {
      await setup();
      const results = await Promise.allSettled([run((tx) => writeRequestStatusUpdate(tx, 'employee', input(10))), run((tx) => writeRequestStatusUpdate(tx, 'employee', input(10)))]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const result = await run((tx) => tx.execute(sql`SELECT budget FROM capdevs WHERE id=1`));
      assert.equal(result.rows[0].budget, '3000.00');
    });
    await t.test('a failed timeline insert rolls back its deduction', async () => {
      await setup();
      await run((tx) => writeRequestStatusUpdate(tx, 'employee', input(10, { subtractsRequestedAmount: false, markAsComplete: true })));
      await assert.rejects(run((tx) => writeRequestStatusUpdate(tx, 'employee', input(10, { markAsComplete: true }))));
      const result = await run((tx) => tx.execute(sql`SELECT budget FROM capdevs WHERE id=1`));
      assert.equal(result.rows[0].budget, '10000.00');
    });
    await t.test('employees cannot deduct another owner request or use negative amounts', async () => {
      await setup();
      await assert.rejects(run((tx) => writeRequestStatusUpdate(tx, 'employee', input(20))), /permission/);
      await assert.rejects(run((tx) => writeRequestStatusUpdate(tx, 'employee', input(10, { deductedAmount: '-10' }))), /positive/);
    });
    await t.test('folder claiming rejects arbitrary and other-user folders', async () => {
      await setup();
      const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
      assert.ok(root, 'Drive root is configured');
      await run((tx) => tx.execute(sql`INSERT INTO request_storage_folders (folder_id,user_id,root_folder_id) VALUES ('owned','owner',${root}),('other','other',${root})`));
      await assert.rejects(run((tx) => claimRequestFolder(tx, 'owner', 10, { googleDriveFolderId: 'unknown' })), /permission/);
      await assert.rejects(run((tx) => claimRequestFolder(tx, 'owner', 10, { googleDriveFolderId: 'other' })), /permission/);
      await run((tx) => claimRequestFolder(tx, 'owner', 10, { googleDriveFolderId: 'owned' }));
      const result = await run((tx) => tx.execute(sql`SELECT request_id FROM request_storage_folders WHERE folder_id='owned'`));
      assert.equal(result.rows[0].request_id, 10);
    });
    await t.test('legacy folder JSON is stripped rather than trusted', async () => {
      await setup();
      await run((tx) => tx.execute(sql`UPDATE requests SET additional_info='{"googleDriveFolderId":"legacy"}'::jsonb WHERE id=10`));
      const data = { googleDriveFolderId: 'legacy', 'field:1': 'existing' };
      await run((tx) => claimRequestFolder(tx, 'owner', 10, data));
      assert.deepEqual(data, { 'field:1': 'existing' });
    });
    await t.test('concurrent rate-limit attempts cannot bypass the account limit', async () => {
      const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => run((tx) => tx.execute(rateLimitStatement('test-account', 900000)))));
      for (const attempt of attempts) assert.equal(attempt.status, 'fulfilled', attempt.reason?.message);
      const counts = attempts.map((result) => Number(result.value.rows[0].attempts));
      assert.equal(counts.filter((attempt) => attempt <= 5).length, 5, JSON.stringify(counts));
      await run((tx) => tx.execute(sql`UPDATE security_rate_limits SET expires_at=NOW()-INTERVAL '1 second' WHERE key='test-account'`));
      const renewed = await run((tx) => tx.execute(rateLimitStatement('test-account', 900000)));
      assert.equal(renewed.rows[0].attempts, 1);
    });
  } finally {
    // This name is generated here and never derives from user input.
    if (!/^security_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid disposable schema name.');
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
  }
});
