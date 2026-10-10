import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
const context = new AsyncLocalStorage();
globalThis.workflowTestDb = new Proxy({}, { get(_, key) {
  const db = context.getStore();
  return typeof db[key] === 'function' ? db[key].bind(db) : db[key];
} });
const virtual = source => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
registerHooks({ resolve(specifier, ctx, next) {
  if (specifier === '@/db') return virtual('export const db = globalThis.workflowTestDb;');
  if (specifier === '@/db/transaction') return virtual('export const withTransaction = run => globalThis.workflowTestDb.transaction(run);');
  if (specifier === '@/lib/notification-email') return virtual('export const scheduleNotificationEmails = () => {};');
  return next(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const { getMyRequestsSummaryService: summary, getRequestStatusService: requestStatus, listAvailableCapdevProjectsService: projects,
  getDepartmentBudgetBalanceService: budget, submitRequestService: submit } = await import('../src/lib/services/leaprs-service.ts');
const { writeRequestStatusUpdate } = await import('../src/lib/request-budget.ts');
const { insertNotificationEvent } = await import('../src/lib/notification-events.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = 'workflow_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + schema + '"';
const access = role => ({ userId: 'owner', role, department: 'Alpha', name: 'Requestor' });

test('AI scopes, counts and notification rollback in an isolated schema', async t => {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA ' + quoted);
    for (const table of ['capdevs', 'requests', 'request_status_updates', 'request_field_definitions', 'request_storage_folders', 'notifications', 'audit_logs']) {
      await client.query(`CREATE TABLE ${quoted}."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
      if (table !== 'request_storage_folders') {
        await client.query(`CREATE SEQUENCE ${quoted}."${table}_test_id" START 100`);
        await client.query(`ALTER TABLE ${quoted}."${table}" ALTER COLUMN id SET DEFAULT nextval('${schema}.${table}_test_id')`);
      }
    }
    await drizzle(client).transaction(async tx => {
      await tx.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
      await context.run(tx, async () => {
        await tx.execute(sql`INSERT INTO capdevs(id,aip_code,department,initial_budget,budget,updated_by_id) VALUES
          (1,'2026-001-1-1-01-001-001','Alpha',10000,10000,'owner'),
          (2,'2026-001-1-1-01-001-002','Beta',20000,20000,'owner'),
          (3,'2026-001-1-1-01-001-003','Alpha',10000,10000,'owner')`);
        await tx.execute(sql`UPDATE capdevs SET archived_at = NOW() WHERE id = 3`);
        await tx.execute(sql`INSERT INTO requests(id,capdev_id,user_id,setting,requested_budget,status,is_stopped,updated_by_id) VALUES
          (1,1,'owner','internal',100,'in_progress',false,'owner'),
          (2,1,'other','internal',100,'completed',false,'other'),
          (3,2,'other','internal',100,'in_progress',true,'other'),
          (4,2,'owner','internal',100,'denied',false,'owner'),
          (5,3,'owner','internal',100,'completed',false,'owner'),
          (6,1,'owner','internal',100,'in_progress',false,'owner'),
          (7,1,'owner','internal',100,'completed',false,'owner')`);
        await tx.execute(sql`UPDATE requests SET archived_at = NOW() WHERE id = 7`);
        await tx.execute(sql`INSERT INTO request_status_updates(request_id,user_id,status_update,mark_as_complete) VALUES (6,'owner','Complete',true)`);
        await t.test('all department managers count beyond the recent result limit', async () => {
          const result = await summary(access('employee-department'), { limit: 1 });
          assert.equal(result.requests.length, 1);
          assert.equal(result.summary.totalFound, 5);
          assert.equal(result.summary.completeCount, 2);
          assert.equal(result.summary.stoppedCount, 1);
          assert.equal(result.summary.inProgressCount, 1);
          assert.equal(result.summary.deniedCount, 1);
        });
        await t.test('employees see only their requests while viewers are department scoped', async () => {
          assert.deepEqual((await summary(access('employee'))).requests.map(r => r.id).sort(), [1,4,6]);
          assert.deepEqual((await summary(access('viewer'))).requests.map(r => r.id).sort(), [1,2,6]);
          for (const role of ['admin', 'viewer-full']) assert.equal((await summary(access(role))).summary.totalFound, 5);
        });
        await t.test('completed timeline marks and separate stopped flags match portal statuses', async () => {
          assert.deepEqual((await summary(access('admin'), { status: 'completed' })).requests.map(r => r.id).sort(), [2,6]);
          assert.deepEqual((await summary(access('admin'), { status: 'stopped' })).requests.map(r => r.id), [3]);
          assert.deepEqual((await summary(access('admin'), { status: 'in_progress' })).requests.map(r => r.id), [1]);
          assert.equal((await requestStatus(access('admin'), 6)).request.status, 'completed');
          assert.equal((await requestStatus(access('employee'), 3)).success, false);
        });
        await t.test('project and budget access follows portal permissions', async () => {
          for (const role of ['admin','employee','employee-department','viewer-full']) {
            assert.equal((await projects(access(role))).projects.length, 2);
            assert.equal((await budget(access(role), 'Beta')).totalRemainingBudget, '20000.00');
          }
          assert.equal((await projects(access('viewer'))).projects.length, 1);
          await assert.rejects(() => budget(access('viewer'), 'Beta'), /permission/);
          await assert.rejects(() => projects(access('viewer'), { department: 'Beta' }), /permission/);
        });
        await tx.execute(sql.raw(`CREATE FUNCTION ${quoted}.reject_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Notification insert failed'; END $$`));
        await tx.execute(sql.raw('CREATE TRIGGER reject_notification BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION ' + quoted + '.reject_notification()'));
        const input = { aipCode: '2026-001-1-1-01-001-001', setting: 'internal', requestedBudget: '100', userConfirmed: true };
        await t.test('actual AI request creation rolls back when its notification fails', async () => {
          await assert.rejects(() => submit(access('employee'), input), error => error.cause?.message === 'Notification insert failed');
          assert.equal((await tx.execute(sql`SELECT count(*)::int AS n FROM requests`)).rows[0].n, 7);
          assert.equal((await tx.execute(sql`SELECT count(*)::int AS n FROM notifications`)).rows[0].n, 0);
        });
        await t.test('notification failure also rolls back timeline progress and budget deduction', async () => {
          await assert.rejects(() => tx.transaction(async inner => {
            await writeRequestStatusUpdate(inner, 'admin', { requestId: 1, userId: 'owner', statusUpdate: 'Accepted',
              statusMark: 'accepted', subtractsRequestedAmount: true, files: [], additionalInfo: {} });
            await insertNotificationEvent(inner, { actorId: 'owner', requestId: 1, capdevId: 1, title: 'Update', message: 'Updated', link: '/portal', type: 'status_update' });
          }), error => error.cause?.message === 'Notification insert failed');
          assert.equal((await tx.execute(sql`SELECT budget FROM capdevs WHERE id = 1`)).rows[0].budget, '10000.00');
          assert.equal((await tx.execute(sql`SELECT budget_deducted_at FROM requests WHERE id = 1`)).rows[0].budget_deducted_at, null);
          assert.equal((await tx.execute(sql`SELECT count(*)::int AS n FROM request_status_updates WHERE request_id = 1`)).rows[0].n, 0);
        });
        await tx.execute(sql`DROP TRIGGER reject_notification ON notifications`);
        await t.test('successful submission saves record and notification together without deducting funds', async () => {
          const result = await submit(access('employee'), input);
          assert.equal(result.success, true);
          const events = await tx.execute(sql`SELECT request_id FROM notifications`);
          assert.equal(events.rows[0].request_id, result.request.id);
          assert.equal((await tx.execute(sql`SELECT budget FROM capdevs WHERE id = 1`)).rows[0].budget, '10000.00');
        });
      });
    });
  } finally {
    await client.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    client.release(); await pool.end();
  }
});
