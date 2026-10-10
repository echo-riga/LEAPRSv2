import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
process.env.APP_URL = 'https://leaprs.example.test';
const context = new AsyncLocalStorage();
const dialect = new PgDialect();
globalThis.emailTestDb = new Proxy({}, { get(_, key) {
  const { db, client } = context.getStore();
  if (key === 'execute') return query => {
    const compiled = dialect.sqlToQuery(query);
    return compiled.sql.includes('neon_auth.user')
      ? client.query(compiled.sql.replace('neon_auth.user', 'auth_users'), compiled.params)
      : db.execute(query);
  };
  return typeof db[key] === 'function' ? db[key].bind(db) : db[key];
} });
const sent = [], keys = new Set();
let fail = false;
globalThis.emailTestSend = async (payload, options) => {
  if (fail) return { error: { name: 'rate_limit_exceeded' } };
  if (!keys.has(options.idempotencyKey)) {
    keys.add(options.idempotencyKey);
    sent.push({ payload, key: options.idempotencyKey });
  }
  return { data: { id: randomUUID() }, error: null };
};
const dataModule = text => 'data:text/javascript,' + encodeURIComponent(text);
registerHooks({ resolve(specifier, ctx, nextResolve) {
  if (specifier === '@/db') return { url: dataModule('export const db = globalThis.emailTestDb;'), shortCircuit: true };
  if (specifier === 'resend') return { url: dataModule('export class Resend { emails = { send: globalThis.emailTestSend }; }'), shortCircuit: true };
  if (specifier === 'next/server') return { url: dataModule('export function after() {}'), shortCircuit: true };
  return nextResolve(specifier.startsWith('@/') ? new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const { deliverNotificationEmails, notificationEmailPayload } = await import('../src/lib/notification-email.ts');
const { validateEmailTypes, DEFAULT_EMAIL_TYPES } = await import('../src/lib/notification-types.ts');
const { GET: emailJob } = await import('../src/app/api/notifications/email/route.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const name = 'email_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + name + '"';
async function transaction(run) {
  const client = await pool.connect();
  try {
    return await drizzle(client).transaction(async db => {
      await db.execute(sql.raw('SET LOCAL search_path TO ' + quoted));
      return context.run({ db, client }, () => run(db));
    });
  } finally { client.release(); }
}

test('notification emails preserve audience, preferences and idempotency in disposable tables', async t => {
  try {
    await pool.query('CREATE SCHEMA ' + quoted);
    for (const table of ['users', 'capdevs', 'requests', 'request_status_updates', 'system_settings', 'notifications', 'email_notification_preferences', 'notification_email_deliveries']) {
      await pool.query(`CREATE TABLE ${quoted}."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    }
    await pool.query(`CREATE SEQUENCE ${quoted}.delivery_id`);
    await pool.query(`ALTER TABLE ${quoted}.notification_email_deliveries ALTER COLUMN id SET DEFAULT nextval('${name}.delivery_id')`);
    await pool.query(`CREATE TABLE ${quoted}.auth_users (id uuid PRIMARY KEY, email text)`);
    await t.test('UUID authentication IDs join application text IDs', async () => {
      await transaction(async db => {
        const userId = randomUUID();
        await db.execute(sql`INSERT INTO users(id,role,department) VALUES (${userId},'admin','Alpha')`);
        await db.execute(sql`INSERT INTO auth_users(id,email) VALUES (${userId}::uuid,'uuid@example.test')`);
        assert.deepEqual(await deliverNotificationEmails(), { sent: 0, configured: true });
        await db.execute(sql`DELETE FROM users WHERE id = ${userId}`);
      });
    });
    await pool.query(`DROP TABLE ${quoted}.auth_users`);
    await pool.query(`CREATE TABLE ${quoted}.auth_users (id text PRIMARY KEY, email text)`);
    await transaction(async db => {
      await db.execute(sql`INSERT INTO users(id,role,department) VALUES
        ('admin','admin','Alpha'),('owner','employee','Alpha'),('viewer','viewer','Alpha'),
        ('other','viewer','Beta'),('full','viewer-full','Beta'),('archived','admin','Alpha')`);
      await db.execute(sql`UPDATE users SET archived_at = NOW() WHERE id = 'archived'`);
      await db.execute(sql`INSERT INTO auth_users SELECT id, id || '@example.test' FROM users`);
      await db.execute(sql`INSERT INTO capdevs(id,aip_code,department,initial_budget,budget,updated_by_id) VALUES (1,'TEST-A','Alpha',100,100,'owner')`);
      await db.execute(sql`INSERT INTO requests(id,capdev_id,user_id,setting,requested_budget,updated_by_id) VALUES (1,1,'owner','internal',10,'owner')`);
      await db.execute(sql`INSERT INTO notifications(id,actor_id,capdev_id,request_id,title,message,link,type,email_eligible) VALUES
        (1,'owner',1,1,'New request','New event','/portal/capdev/1/requests#request-record-1','new_request',true),
        (2,'admin',1,1,'Update','Progress event','/portal/capdev/1/requests/1/status#request-status-update-1','status_update',true),
        (3,'owner',1,NULL,'CapDev','Project event','/portal#capdev-record-1','capdev_created',true),
        (4,NULL,NULL,NULL,'Approval','Role event','/portal/users?approval=1','role_approval',true),
        (5,'owner',1,1,'Historic','Old event','/portal','new_request',false)`);
      await db.execute(sql`INSERT INTO email_notification_preferences(user_id,enabled_types) VALUES ('viewer','["capdev_created"]'::jsonb)`);
    });
    await t.test('only involved, active users receive selected event types', async () => {
      await transaction(async () => { await deliverNotificationEmails(); });
      assert.deepEqual(sent.map(item => `${item.payload.to}:${item.key.split('/')[1]}`).sort(), [
        'admin@example.test:1','admin@example.test:4','full@example.test:1','full@example.test:2',
        'full@example.test:3','owner@example.test:2','viewer@example.test:3',
      ].sort());
      assert.ok(sent.every(item => item.payload.text.includes('https://leaprs.example.test/portal')));
      assert.ok(sent.every(item => !item.payload.text.includes('Historic')));
    });
    await t.test('concurrent refreshes and re-enabling filters cannot resend old events', async () => {
      await transaction(async db => {
        await db.execute(sql`UPDATE email_notification_preferences SET enabled_types = '["new_request","status_update","capdev_created"]'::jsonb WHERE user_id = 'viewer'`);
        await Promise.all([deliverNotificationEmails(), deliverNotificationEmails()]);
      });
      assert.equal(sent.length, 7);
    });
    await t.test('failed sends retry, and disabling a queued type suppresses its delivery', async () => {
      await transaction(async db => {
        await db.execute(sql`INSERT INTO notifications(id,actor_id,capdev_id,request_id,title,message,link,type)
          VALUES (6,'admin',1,1,'Retry','New retry event','/portal','status_update')`);
        fail = true;
        await deliverNotificationEmails();
        fail = false;
        await db.execute(sql`UPDATE email_notification_preferences SET enabled_types = '[]'::jsonb WHERE user_id = 'viewer'`);
        await db.execute(sql`UPDATE notification_email_deliveries SET next_attempt_at = NOW() WHERE status = 'pending'`);
        await deliverNotificationEmails();
        await deliverNotificationEmails();
      });
      const retried = sent.filter(item => item.key.includes('/6/'));
      assert.deepEqual(retried.map(item => item.payload.to).sort(), ['full@example.test', 'owner@example.test']);
    });
    await t.test('invalid selections and external links are rejected', () => {
      assert.deepEqual(validateEmailTypes([]), []);
      assert.throws(() => validateEmailTypes(['unknown']));
      assert.throws(() => validateEmailTypes(['new_request', 'new_request']));
      assert.throws(() => notificationEmailPayload({ title: 'x', message: 'x', link: '//evil.example' }, 'x@example.test', 'https://leaprs.example.test'));
    });
    await t.test('email job rejects absent or incorrect credentials before touching data', async () => {
      const previous = process.env.CRON_SECRET;
      try {
        delete process.env.CRON_SECRET;
        assert.equal((await emailJob(new Request('https://leaprs.example.test/api/notifications/email'))).status, 401);
        process.env.CRON_SECRET = 'test-secret';
        assert.equal((await emailJob(new Request('https://leaprs.example.test/api/notifications/email', { headers: { authorization: 'Bearer wrong' } }))).status, 401);
      } finally {
        if (previous === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
      }
    });
    await t.test('preference actions require authentication and only update the signed-in user', async () => {
      const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
      const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
      const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['getEmailNotificationPreferences', 'saveEmailNotificationPreferences'].includes(node.name?.text));
      const compiled = ts.transpileModule(nodes.map(node => node.getText(ast).replace(/^export /, '')).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      let signedIn = false, saved;
      const fakeDb = { insert: () => ({ values: value => ({ onConflictDoUpdate: async () => { saved = value; } }) }) };
      const save = new Function('getCurrentAccess', 'db', 'emailNotificationPreferences', 'unauthorized', 'validateEmailTypes', 'DEFAULT_EMAIL_TYPES', 'eq',
        compiled + '\nreturn saveEmailNotificationPreferences;')(async () => signedIn ? { userId: 'owner' } : null, fakeDb, { userId: 'user_id' }, { error: 'Unauthorized' }, validateEmailTypes, DEFAULT_EMAIL_TYPES, () => {});
      assert.equal((await save(['status_update'])).success, false);
      assert.equal(saved, undefined);
      signedIn = true;
      assert.equal((await save({ userId: 'admin', enabledTypes: ['status_update'] })).success, false);
      assert.equal((await save(['status_update'])).success, true);
      assert.deepEqual(saved, { userId: 'owner', enabledTypes: ['status_update'] });
    });
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    await pool.end();
  }
});
