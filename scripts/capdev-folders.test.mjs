import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, context);
} });
const { manageCapdevRecords } = await import('../src/lib/capdev-bulk.ts');
const { capdevs, requests } = await import('../src/db/schema.ts');
const { capdevAccessScope, requestAccessScope } = await import('../src/lib/access-scope.ts');
const { activateCapdevFolder, assertActiveFolderAccess } = await import('../src/lib/active-capdev-folder.ts');
const { writeRequestStatusUpdate } = await import('../src/lib/request-budget.ts');
const { deleteCapdevFolderRecords } = await import('../src/lib/capdev-folder-deletion.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = 'capdev_folder_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + schema + '"';
const actor = { actorId: 'admin', actorName: 'Test admin', actorEmail: null };
const migration = ['0021_capdev_folders.sql', '0022_active_capdev_folder.sql', '0023_capdev_folder_reference_image.sql'].flatMap(file => readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8').split(';').map(s => s.trim()).filter(Boolean));
async function run(callback) {
  return drizzle(pool).transaction(async tx => {
    await tx.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
    assert.equal((await tx.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema, schema);
    return callback(tx);
  });
}

test('CapDev folders preserve migration data and isolate cascading deletion', async t => {
  try {
    await pool.query('CREATE SCHEMA ' + quoted);
    for (const table of ['capdevs', 'requests', 'request_status_updates', 'request_storage_folders', 'notifications', 'notification_reads', 'notification_email_deliveries', 'audit_logs']) {
      await pool.query('CREATE TABLE ' + quoted + '."' + table + '" (LIKE public."' + table + '" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)');
    }
    await run(async tx => {
      await tx.execute(sql`ALTER TABLE capdevs DROP COLUMN folder_id`);
      await tx.execute(sql`INSERT INTO capdevs (id,aip_code,budget,department,updated_by_id) VALUES (1,'OLD','100','Test','admin')`);
    });
    await t.test('migration backfills existing projects and is safe to rerun', async () => {
      await run(async tx => {
        for (const statement of migration) await tx.execute(sql.raw(statement));
        for (const statement of migration) await tx.execute(sql.raw(statement));
        const result = await tx.execute(sql`SELECT c.aip_code, f.name FROM capdevs c JOIN capdev_folders f ON f.id=c.folder_id`);
        assert.deepEqual(result.rows, [{ aip_code: 'OLD', name: 'Existing CapDev' }]);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM capdev_folders`)).rows[0].total, 1);
      });
    });
    await run(async tx => {
      await tx.execute(sql`CREATE SEQUENCE audit_test_id`);
      await tx.execute(sql`ALTER TABLE audit_logs ALTER COLUMN id SET DEFAULT nextval('audit_test_id')`);
      await tx.execute(sql`ALTER TABLE requests ADD FOREIGN KEY (capdev_id) REFERENCES capdevs(id)`);
      await tx.execute(sql`ALTER TABLE request_status_updates ADD FOREIGN KEY (request_id) REFERENCES requests(id)`);
      await tx.execute(sql`ALTER TABLE request_storage_folders ADD FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE`);
      await tx.execute(sql`ALTER TABLE notifications ADD FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE`);
      await tx.execute(sql`ALTER TABLE notifications ADD FOREIGN KEY (capdev_id) REFERENCES capdevs(id) ON DELETE CASCADE`);
      await tx.execute(sql`ALTER TABLE notification_reads ADD FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE`);
      await tx.execute(sql`ALTER TABLE notification_email_deliveries ADD FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE`);
      await tx.execute(sql`INSERT INTO capdev_folders (id,name) VALUES (2,'Keep'),(3,'Delete'),(4,'Empty')`);
      await tx.execute(sql`INSERT INTO capdevs (id,folder_id,aip_code,budget,department,updated_by_id,archived_at) VALUES (2,2,'KEEP','50','Other','admin',NULL),(3,3,'ACTIVE','100','Test','admin',NULL),(4,3,'ARCHIVED','75','Test','admin',NOW())`);
      await tx.execute(sql`INSERT INTO requests (id,capdev_id,user_id,setting,requested_budget,updated_by_id,archived_at) VALUES (20,2,'admin','internal','10','admin',NULL),(30,3,'admin','internal','10','admin',NULL),(40,4,'admin','external','10','admin',NOW())`);
      await tx.execute(sql`INSERT INTO request_status_updates (id,request_id,user_id,status_update,subtracts_requested_amount) VALUES (20,20,'admin','Keep',true),(30,30,'admin','Delete',true),(40,40,'admin','Archived',false)`);
      await tx.execute(sql`INSERT INTO request_storage_folders (folder_id,request_id,user_id,root_folder_id) VALUES ('keep',20,'admin','root'),('delete',30,'admin','root')`);
      await tx.execute(sql`INSERT INTO notifications (id,capdev_id,request_id,title,message,link) VALUES (20,2,20,'Keep','Keep','/portal'),(30,3,30,'Delete','Delete','/portal'),(40,4,NULL,'Archived','Archived','/portal')`);
      await tx.execute(sql`INSERT INTO notification_reads (id,notification_id,user_id) VALUES (20,20,'admin'),(30,30,'admin')`);
      await tx.execute(sql`INSERT INTO notification_email_deliveries (id,notification_id,user_id,payload) VALUES (20,20,'admin','{}'),(30,30,'admin','{}')`);
    });
    await t.test('bulk operations reject cross-folder and incompatible selections before changes', async () => {
      for (const [folder, ids, action] of [[3,[2,3],'archive'],[3,[3,4],'archive'],[3,[3],'delete'],[3,[4,4],'delete']]) {
        await assert.rejects(run(tx => manageCapdevRecords(tx, folder, ids, action, actor, async () => {})));
      }
      await run(async tx => {
        assert.equal((await tx.execute(sql`SELECT archived_at FROM capdevs WHERE id=3`)).rows[0].archived_at, null);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM audit_logs`)).rows[0].total, 0);
      });
    });
    await t.test('bulk archive retains descendants and budgets and records audit history', async () => {
      await assert.rejects(run(async tx => {
        await manageCapdevRecords(tx, 3, [3], 'archive', actor, async () => { throw new Error('Archive must not clean storage'); });
        assert.ok((await tx.execute(sql`SELECT archived_at FROM capdevs WHERE id=3`)).rows[0].archived_at);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM requests WHERE id=30`)).rows[0].total, 1);
        assert.equal((await tx.execute(sql`SELECT budget FROM capdevs WHERE id=3`)).rows[0].budget, '100.00');
        assert.equal((await tx.execute(sql`SELECT action FROM audit_logs`)).rows[0].action, 'archived');
        throw new Error('rollback fixture');
      }), /rollback fixture/);
    });
    await t.test('bulk delete removes only selected archived projects and cascades their descendants', async () => {
      await assert.rejects(run(async tx => {
        let cleaned = [];
        await manageCapdevRecords(tx, 3, [4], 'delete', actor, async projects => { cleaned = projects.map(project => project.id); });
        assert.deepEqual(cleaned, [4]);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM requests WHERE id=40`)).rows[0].total, 0);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM notifications WHERE id=40`)).rows[0].total, 0);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM capdevs WHERE id=3`)).rows[0].total, 1);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM capdev_folders WHERE id=3`)).rows[0].total, 1);
        throw new Error('rollback fixture');
      }), /rollback fixture/);
      await assert.rejects(run(tx => manageCapdevRecords(tx, 3, [4], 'delete', actor, async () => { throw new Error('storage failed'); })), /storage failed/);
      assert.equal((await run(tx => tx.execute(sql`SELECT count(*)::int AS total FROM capdevs WHERE id=4`))).rows[0].total, 1);
    });
    await t.test('moving projects preserves active and archived records, children, storage, dates, balances, and the active folder', async () => {
      await assert.rejects(run(async tx => {
        const before = (await tx.execute(sql`SELECT * FROM capdevs WHERE id IN (3,4) ORDER BY id`)).rows;
        const snapshots = {};
        for (const table of ['requests','request_status_updates','request_storage_folders','notifications','capdev_folders']) snapshots[table] = (await tx.execute(sql.raw('SELECT * FROM ' + table + ' ORDER BY 1'))).rows;
        await manageCapdevRecords(tx, 3, [3,4], 'move', actor, async () => { throw new Error('Moving must not clean storage'); }, 2);
        const after = (await tx.execute(sql`SELECT * FROM capdevs WHERE id IN (3,4) ORDER BY id`)).rows;
        for (let index = 0; index < before.length; index++) {
          const { updated_at: beforeUpdated, ...original } = before[index];
          const { updated_at: afterUpdated, ...moved } = after[index];
          assert.ok(beforeUpdated);
          assert.ok(afterUpdated);
          assert.deepEqual(moved, { ...original, folder_id: 2, updated_by_id: 'admin' });
        }
        for (const table of Object.keys(snapshots)) assert.deepEqual((await tx.execute(sql.raw('SELECT * FROM ' + table + ' ORDER BY 1'))).rows, snapshots[table]);
        const logs = (await tx.execute(sql`SELECT details FROM audit_logs WHERE entity_type='capdev'`)).rows;
        assert.equal(logs.length, 2);
        assert.equal(logs[0].details.destinationFolderId, 2);
        assert.deepEqual(logs[0].details.changes[0], { field: 'folderId', label: 'Folder', from: 'Delete', to: 'Keep' });
        throw new Error('rollback move fixture');
      }), /rollback move fixture/);
    });
    await t.test('move rejects same, missing, invalid, and cross-folder destinations/selections atomically', async () => {
      for (const destination of [3,0,999,-1,1.5,undefined]) await assert.rejects(run(tx => manageCapdevRecords(tx, 3, [3], 'move', actor, async () => {}, destination)));
      await assert.rejects(run(tx => manageCapdevRecords(tx, 3, [2,3], 'move', actor, async () => {}, 2)));
      const result = await run(tx => tx.execute(sql`SELECT folder_id FROM capdevs WHERE id=3`));
      assert.equal(result.rows[0].folder_id, 3);
    });
    await t.test('only one folder can be active, including simultaneous activation requests', async () => {
      await Promise.all([run(tx => activateCapdevFolder(tx, 2)), run(tx => activateCapdevFolder(tx, 3))]);
      await run(async tx => {
        const result = await tx.execute(sql`SELECT id FROM capdev_folders WHERE is_active`);
        assert.equal(result.rows.length, 1);
        assert.ok([2,3].includes(result.rows[0].id));
      });
      await run(tx => activateCapdevFolder(tx, 1));
      await assert.rejects(run(tx => tx.execute(sql`UPDATE capdev_folders SET is_active=true WHERE id=2`)), error => error.cause?.code === '23505');
      await assert.rejects(run(tx => activateCapdevFolder(tx, 999)), /no longer exists/);
      assert.equal((await run(tx => tx.execute(sql`SELECT id FROM capdev_folders WHERE is_active`))).rows[0].id, 1);
    });
    await t.test('non-Admin project and request scopes exclude inactive folders and retain department/ownership rules', async () => {
      await run(tx => activateCapdevFolder(tx, 2));
      const access = role => ({ userId: 'admin', role, department: 'Test' });
      for (const role of ['employee','employee-department','viewer','viewer-full']) {
        await run(async tx => {
          const visible = await tx.select({ id: capdevs.id }).from(capdevs).where(capdevAccessScope(access(role)));
          assert.deepEqual(visible.map(row => row.id), role === 'viewer' ? [] : [2]);
          const visibleRequests = await tx.select({ id: requests.id }).from(requests).innerJoin(capdevs, sql`${requests.capdevId} = ${capdevs.id}`).where(requestAccessScope(access(role)));
          assert.deepEqual(visibleRequests.map(row => row.id), role === 'viewer' ? [] : [20]);
        });
      }
      await run(async tx => {
        assert.equal((await tx.select().from(capdevs).where(capdevAccessScope(access('admin')))).length, 4);
        assert.deepEqual((await tx.select({ id: capdevs.id }).from(capdevs).where(capdevAccessScope(access('admin'), true))).map(row => row.id), [2]);
        const owned = await tx.select().from(requests).innerJoin(capdevs, sql`${requests.capdevId} = ${capdevs.id}`).where(requestAccessScope({ ...access('employee'), userId: 'other' }));
        assert.equal(owned.length, 0);
      });
    });
    await t.test('inactive-folder writes and deletion of the active folder are rejected', async () => {
      await assert.rejects(run(tx => writeRequestStatusUpdate(tx, 'employee-department', { requestId: 30, userId: 'admin', statusUpdate: 'Disallowed', subtractsRequestedAmount: true, files: [], additionalInfo: {} })), /no longer active/);
      await assert.rejects(run(tx => deleteCapdevFolderRecords(tx, 2, actor)), /Activate another folder/);
      await run(async tx => {
        assert.equal((await tx.execute(sql`SELECT budget FROM capdevs WHERE id=3`)).rows[0].budget, '100.00');
      });
    });
    await t.test('activation waits for an authorized in-flight write before changing its folder', async () => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let entered;
      const ready = new Promise(resolve => { entered = resolve; });
      const writer = run(async tx => { await assertActiveFolderAccess(tx, 'employee', 2); entered(); await gate; });
      await ready;
      try {
        await assert.rejects(run(async tx => { await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`); await activateCapdevFolder(tx, 3); }), error => error.cause?.code === '55P03');
      } finally { release(); await writer; }
      await run(tx => activateCapdevFolder(tx, 1));
    });
    await t.test('failure rolls back folder, descendants, and audit entries', async () => {
      await assert.rejects(run(async tx => { await deleteCapdevFolderRecords(tx, 3, actor); throw new Error('rollback'); }), /rollback/);
      await run(async tx => {
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM requests WHERE capdev_id IN (3,4)`)).rows[0].total, 2);
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM audit_logs`)).rows[0].total, 0);
      });
    });
    await t.test('deletes active and archived contents, cascades notification reads/deliveries, retains unrelated balances and audit', async () => {
      await run(tx => deleteCapdevFolderRecords(tx, 3, actor));
      await run(async tx => {
        assert.deepEqual((await tx.execute(sql`SELECT id FROM capdevs ORDER BY id`)).rows.map(row => row.id), [1,2]);
        for (const table of ['requests','request_status_updates','notifications','notification_reads','notification_email_deliveries']) {
          assert.deepEqual((await tx.execute(sql.raw('SELECT id FROM ' + table))).rows.map(row => row.id), [20]);
        }
        assert.deepEqual((await tx.execute(sql`SELECT folder_id FROM request_storage_folders`)).rows, [{ folder_id: 'keep' }]);
        assert.equal((await tx.execute(sql`SELECT budget FROM capdevs WHERE id=2`)).rows[0].budget, '50.00');
        assert.equal((await tx.execute(sql`SELECT count(*)::int AS total FROM audit_logs`)).rows[0].total, 5);
      });
    });
    await t.test('empty folders can be deleted and missing folders are rejected', async () => {
      await run(tx => deleteCapdevFolderRecords(tx, 4, actor));
      await assert.rejects(run(tx => deleteCapdevFolderRecords(tx, 4, actor)), /no longer exists/);
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
  }
});
