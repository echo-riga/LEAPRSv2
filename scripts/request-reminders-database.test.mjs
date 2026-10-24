import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { and, asc, desc, count, gte, lte, ilike, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
const context = new AsyncLocalStorage();
globalThis.reminderTestContext = context;
const dbStub = 'data:text/javascript,' + encodeURIComponent('export const db = new Proxy({}, { get(_, key) { const db = globalThis.reminderTestContext.getStore(); const value = db[key]; return typeof value === "function" ? value.bind(db) : value; } });');
registerHooks({ resolve(specifier, ctx, nextResolve) {
  if (specifier === '@/db') return { url: dbStub, shortCircuit: true };
  return nextResolve(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const { syncRequestReminders, getRequestInactivitySummaries, activeReminderCondition, readInactivityDays } = await import('../src/lib/request-reminders.ts');
const { activeFolderScope, capdevAccessScope } = await import('../src/lib/access-scope.ts');
const { requests, capdevs, notifications, requestStatusUpdates, auditLogs } = await import('../src/db/schema.ts');
const source = readFileSync(new URL('../src/lib/notification-audience.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const declarations = ast.statements.filter((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ['REQUEST_NOTIFICATION_TYPES', 'ALL_NOTIFICATION_TYPES', 'OWNER_NOTIFICATION_TYPES'].includes(d.name.getText(ast))));
const audienceNode = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'notificationAudienceCondition');
assert.ok(audienceNode);
const compiled = ts.transpileModule([...declarations, audienceNode].map((node) => node.getText(ast).replace(/^export /, '')).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const audience = new Function('deps', 'const { and, eq, inArray, isNotNull, isNull, ne, or, requests, capdevs, notifications, activeReminderCondition, activeFolderScope } = deps; ' + compiled + '\nreturn notificationAudienceCondition;')({ and, eq, inArray, isNotNull, isNull, ne, or, requests, capdevs, notifications, activeReminderCondition, activeFolderScope });
const { summarizeAnalytics } = await import('../src/lib/analytics-metrics.ts');
const { manilaDateBoundary } = await import('../src/lib/manila-date.ts');
const { db } = await import('@/db');
const actionSource = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const actionAst = ts.createSourceFile('actions.ts', actionSource, ts.ScriptTarget.Latest, true);
const pageCode = ts.transpileModule(['canAccessCapdev', 'getAccessibleCapdev', 'getRequestPage'].map(name => {
  const node = actionAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  return node.getText(actionAst).replace(/^export /, '');
}).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function requestPageFor(user) {
  const deps = { getCurrentAccess: async () => user, db, requests, capdevs, requestStatusUpdates, capdevAccessScope,
    getRequestInactivitySummaries, manilaDateBoundary, and, asc, desc, count, gte, lte, ilike, eq, inArray, isNotNull, isNull, or, sql };
  return new Function(...Object.keys(deps), pageCode + '; return getRequestPage;')(...Object.values(deps));
}
const analyticsNode = actionAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getAnalyticsData');
const analyticsCode = ts.transpileModule(analyticsNode.getText(actionAst).replace(/^export /,''), { compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None} }).outputText;
function analyticsFor(user) {
  const deps={getCurrentAccess:async()=>user,db,capdevs,requests,requestStatusUpdates,auditLogs,capdevAccessScope,manilaDateBoundary,sql,and,or,eq,gte,lte};
  return new Function(...Object.keys(deps),analyticsCode+'; return getAnalyticsData;')(...Object.values(deps));
}
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
    for (const table of ['capdev_folders', 'system_settings', 'capdevs', 'requests', 'request_status_updates', 'notifications', 'audit_logs']) {
      await pool.query('CREATE TABLE ' + quoted + '."' + table + '" (LIKE public."' + table + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
      // Existing fixtures use one logical folder; cloned tables have no folder foreign key.
      if (table === 'capdevs') await pool.query(`ALTER TABLE ${quoted}.capdevs ALTER COLUMN folder_id SET DEFAULT 1`);
      if (table === 'capdev_folders') await pool.query(`INSERT INTO ${quoted}.capdev_folders (id,name,is_active) VALUES (1,'Active',true)`);
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
    await t.test('paginated requests preserve filters, focus links, stable ordering, and live role/folder scope', async () => {
      await transaction(async tx => {
        await tx.execute(sql`INSERT INTO capdev_folders (id,name,is_active) VALUES (2,'Inactive',false)`);
        await tx.execute(sql`INSERT INTO capdevs (id,folder_id,aip_code,department,initial_budget,budget,updated_by_id)
          VALUES (100,1,'PAGE-A','Alpha',10000,10000,'owner'),(101,2,'PAGE-B','Alpha',10000,10000,'owner')`);
        for (let i = 0; i < 20; i++) {
          await tx.execute(sql`INSERT INTO requests (id,capdev_id,user_id,requestor_name,setting,requested_budget,updated_by_id,created_at,archived_at)
            VALUES (${1000+i},100,${i%2 ? 'other' : 'owner'},${i===0 ? '100%' : i===1 ? '100X' : 'User '+i},${i%2 ? 'external' : 'internal'},${String((i+1)*10)},'owner',${new Date(Date.UTC(2026,0,i+1))},${i>=16 ? new Date() : null})`);
        }
        const base = { capdevId:100, page:1, search:'', archived:false,
          filters:{setting:'all',min:'',max:'',dateFrom:'',dateTo:'',sort:'newest'} };
        const read = requestPageFor(access('admin'));
        const first = await read(base);
        assert.equal(first.total,16);
        assert.equal(first.records.length,6);
        assert.deepEqual(first.records.map(row=>row.id),[1015,1014,1013,1012,1011,1010]);
        const last = await read({...base,page:999});
        assert.equal(last.page,3);
        assert.deepEqual(last.records.map(row=>row.id),[1003,1002,1001,1000]);
        assert.equal((await read({...base,search:'100%'})).total,1);
        assert.equal((await read({...base,filters:{...base.filters,setting:'external',min:'40',max:'100'}})).total,4);
        assert.equal((await read({...base,filters:{...base.filters,dateFrom:'2026-01-03',dateTo:'2026-01-04'}})).total,2);
        const focus = await read({...base,search:'no-match',focusId:1000});
        assert.equal(focus.page,3);
        assert.ok(focus.records.some(row=>row.id===1000));
        const archived = await read({...base,focusId:1019});
        assert.equal(archived.archived,true);
        assert.equal(archived.total,4);
        assert.ok(archived.records.some(row=>row.id===1019));
        const employee = await requestPageFor(access('employee'))(base);
        assert.equal(employee.total,8);
        assert.ok(employee.records.every(row=>row.userId==='owner'));
        await assert.rejects(requestPageFor(access('viewer','v','Beta'))(base), /permission/);
        await assert.rejects(requestPageFor(access('viewer-full'))({...base,capdevId:101}), /permission/);
        await assert.rejects(requestPageFor(null)(base), /signed in/);
        await assert.rejects(read({...base,filters:{...base.filters,min:'invalid'}}), /Invalid balance/);
      });
    });

    await t.test('smaller analytics payload preserves historical status, balances, and audit totals', async () => {
      await transaction(async tx => {
        for(let day=1;day<=10;day++) await tx.execute(sql`INSERT INTO request_status_updates
          (id,request_id,user_id,status_update,created_at,subtracts_requested_amount,mark_as_complete)
          VALUES (${9000+day},1000,'owner','History',${new Date(Date.UTC(2026,0,day))},${day===3},${day===8})`);
        await tx.execute(sql`UPDATE requests SET status='completed' WHERE id=1000`);
        await tx.execute(sql`INSERT INTO audit_logs (id,actor_id,actor_name,action,entity_type,entity_id,entity_label,details,created_at)
          VALUES (9000,'owner','Owner','updated','capdev','100','Capdev','{"capdevId":100}','2025-12-01'),
          (9001,'owner','Owner','updated','capdev','100','Capdev','{"capdevId":100}','2026-01-03')`);
        const filters={dateFrom:'2026-01-01',dateTo:'2026-01-06',snapshotDate:'2026-01-05',departments:['Alpha'],capdevIds:[100]};
        const read=analyticsFor(access('admin'));
        const full=await read();
        const reduced=await read(filters);
        assert.ok(full.capdevs.length>0);
        assert.ok(reduced.requestEvents.length<full.requestEvents.length);
        assert.deepEqual(summarizeAnalytics(reduced,filters,'2026-10-24'),summarizeAnalytics(full,filters,'2026-10-24'));
        assert.deepEqual(reduced.auditActivity,full.auditActivity.filter(row=>row.day>=filters.dateFrom&&row.day<=filters.dateTo));
        assert.equal(reduced.auditItems.length,1);
      });
    });

  } finally {
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
    delete globalThis.reminderTestContext;
  }
});
