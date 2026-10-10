import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
const context = new AsyncLocalStorage();
globalThis.reminderTestContext = context;
const dbStub = 'data:text/javascript,' + encodeURIComponent('export const db = new Proxy({}, { get(_, key) { const db = globalThis.reminderTestContext.getStore(); const value = db[key]; return typeof value === "function" ? value.bind(db) : value; } });');
registerHooks({ resolve(specifier, ctx, nextResolve) {
  if (specifier === '@/db') return { url: dbStub, shortCircuit: true };
  return nextResolve(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const { syncRequestReminders, getRequestInactivitySummaries, activeReminderCondition, readInactivityDays } = await import('../src/lib/request-reminders.ts');
const { requests, capdevs, notifications } = await import('../src/db/schema.ts');
const source = readFileSync(new URL('../src/lib/notification-audience.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const declarations = ast.statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['REQUEST_NOTIFICATION_TYPES', 'ALL_NOTIFICATION_TYPES', 'OWNER_NOTIFICATION_TYPES'].includes(d.name.getText(ast))));
const audienceNode = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'notificationAudienceCondition');
assert.ok(audienceNode);
const compiled = ts.transpileModule([...declarations, audienceNode].map((node) => node.getText(ast).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const audience = new Function('deps', 'const { and, eq, inArray, isNotNull, isNull, ne, or, requests, capdevs, notifications, activeReminderCondition } = deps; ' + compiled + '\nreturn notificationAudienceCondition;')({ and, eq, inArray, isNotNull, isNull, ne, or, requests, capdevs, notifications, activeReminderCondition });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schemaName = 'reminder_test_' + randomUUID().replaceAll('-', '');
assert.match(schemaName, /^reminder_test_[a-f0-9]{32}$/);
const quoted = '"' + schemaName + '"';
const access = (role, userId = 'owner', department = 'Alpha') => ({ role, userId, department });
async function transaction(callback) {
  const client = await pool.connect();
  try {
    return await drizzle(client).transaction(async (tx) => {
      await tx.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
      return context.run(tx, () => callback(tx));
    });
  } finally { client.release(); }
}
async function visible(tx, user) {
  return tx.select({ requestId: notifications.requestId }).from(notifications)
    .leftJoin(requests, eq(notifications.requestId, requests.id))
    .leftJoin(capdevs, eq(notifications.capdevId, capdevs.id)).where(audience(user));
}

test('request reminders use a disposable database schema', async (t) => {
  try {
    await pool.query('CREATE SCHEMA ' + quoted);
    for (const table of ['system_settings', 'capdevs', 'requests', 'request_status_updates', 'notifications']) {
      await pool.query('CREATE TABLE ' + quoted + '."' + table + '" (LIKE public."' + table + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
    }
    await pool.query('CREATE SEQUENCE ' + quoted + '.notification_id');
    await pool.query('ALTER TABLE ' + quoted + ".notifications ALTER COLUMN id SET DEFAULT nextval('" + schemaName + ".notification_id')");
    await transaction(async (tx) => {
      assert.equal(await readInactivityDays(), 7);
      await tx.execute(sql`INSERT INTO system_settings (key, number_value) VALUES ('request_inactivity_days', 3)`);
      assert.equal(await readInactivityDays(), 3);
      await tx.execute(sql`INSERT INTO capdevs (id,aip_code,department,initial_budget,budget,updated_by_id,archived_at)
        VALUES (1,'TEST-A','Alpha',10000,10000,'owner',NULL),(2,'TEST-B','Beta',10000,10000,'owner',NULL),(3,'TEST-C','Alpha',10000,10000,'owner',NOW())`);
      await tx.execute(sql`INSERT INTO requests (id,capdev_id,user_id,setting,requested_budget,updated_by_id,status,created_at,archived_at)
        VALUES (10,1,'owner','internal',100,'owner','in_progress',NOW()-INTERVAL '10 days',NULL),
        (20,2,'admin-id','internal',100,'owner','in_progress',NOW()-INTERVAL '10 days',NULL),
        (30,1,'owner','internal',100,'owner','completed',NOW()-INTERVAL '10 days',NULL),
        (40,1,'owner','internal',100,'owner','in_progress',NOW()-INTERVAL '10 days',NOW()),
        (50,1,'owner','internal',100,'owner','in_progress',NOW()-INTERVAL '10 days',NULL),
        (60,3,'owner','internal',100,'owner','in_progress',NOW()-INTERVAL '10 days',NULL),
        (70,1,'owner','internal',100,'owner','in_progress',NOW()-INTERVAL '10 days',NULL)`);
      await tx.execute(sql`INSERT INTO request_status_updates (id,request_id,user_id,status_update,created_at,is_stopper,is_stopper_response,stopper_id,mark_as_complete)
        VALUES (101,10,'owner','Stopper',NOW()-INTERVAL '4 days',true,false,NULL,false),
        (102,10,'owner','Response',NOW()-INTERVAL '3 days 12 hours',false,true,101,false),
        (501,50,'owner','Legacy complete',NOW()-INTERVAL '5 days',false,false,NULL,true),
        (701,70,'owner','Recent',NOW(),false,false,NULL,false)`);
    });
    await t.test('latest response and submission fallback create exactly one reminder per episode', async () => {
      await transaction(async (tx) => {
        const summaries = await getRequestInactivitySummaries([10,20,30,40,50,60,70]);
        assert.deepEqual([...summaries.keys()].sort((a,b)=>a-b), [10,20]);
        assert.ok(summaries.get(10).link.endsWith('#request-status-update-102'));
        assert.ok(summaries.get(20).link.endsWith('#request-status-start'));
        await syncRequestReminders(access('admin','admin-id'));
        await syncRequestReminders(access('admin','admin-id'));
        const count = await tx.execute(sql`SELECT COUNT(*) AS count FROM notifications`);
        assert.equal(Number(count.rows[0].count), 2);
      });
    });
    await t.test('recipient access includes admins even on their own requests and respects owner/department boundaries', async () => {
      await transaction(async (tx) => {
        for (const [user, expected] of [[access('admin','admin-id'),2],[access('employee'),1],[access('employee','outsider'),0],[access('employee-department'),2],[access('viewer','viewer','Alpha'),1],[access('viewer','viewer','Beta'),1],[access('viewer-full'),2]]) {
          assert.equal((await visible(tx,user)).length, expected, user.role + '/' + user.userId + '/' + user.department);
        }
      });
    });
    await t.test('concurrent notification refreshes cannot duplicate reminders', async () => {
      await Promise.all([transaction(()=>syncRequestReminders(access('admin'))), transaction(()=>syncRequestReminders(access('viewer-full')))]);
      await transaction(async (tx) => assert.equal((await visible(tx,access('admin'))).length,2));
    });
    await t.test('new activity immediately hides stale reminders, and a later inactivity episode creates a fresh one', async () => {
      await transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO request_status_updates (id,request_id,user_id,status_update,created_at) VALUES (103,10,'owner','Moved',NOW())`);
        assert.deepEqual((await visible(tx,access('admin'))).map((r)=>r.requestId),[20]);
        await tx.execute(sql`UPDATE request_status_updates SET created_at=NOW()-INTERVAL '3 days 6 hours' WHERE id=103`);
        await syncRequestReminders(access('admin'));
        assert.equal((await visible(tx,access('admin'))).length,2);
        const count = await tx.execute(sql`SELECT COUNT(*) AS count FROM notifications WHERE request_id=10`);
        assert.equal(Number(count.rows[0].count),2);
      });
    });
    await t.test('raising the threshold, concluding, and archiving suppress active reminders', async () => {
      await transaction(async (tx) => {
        await tx.execute(sql`UPDATE system_settings SET number_value=30 WHERE key='request_inactivity_days'`);
        assert.equal((await visible(tx,access('admin'))).length,0);
        await tx.execute(sql`UPDATE system_settings SET number_value=3 WHERE key='request_inactivity_days'`);
        await tx.execute(sql`UPDATE requests SET status='denied' WHERE id=10`);
        await tx.execute(sql`UPDATE capdevs SET archived_at=NOW() WHERE id=2`);
        assert.equal((await visible(tx,access('admin'))).length,0);
      });
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
    delete globalThis.reminderTestContext;
  }
});
