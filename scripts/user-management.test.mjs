import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const code = ['getManageUserOptions', 'bulkManageDirectoryUsers'].map(name => ts.transpileModule(ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).join('\n');
const table = (name, keys) => Object.fromEntries([['table', name], ...keys.map(key => [key, { key }])]);
const users = table('users', ['id']);
const roleApprovalRequests = table('pending', ['id', 'userId', 'status']);
const mcpOAuthGrants = table('grants', ['userId']);
const auditLogs = table('audits', []);
const eq = (column, value) => row => row[column.key] === value;
const inArray = (column, values) => row => values.includes(row[column.key]);
const and = (...conditions) => row => conditions.every(condition => condition(row));
const dialect = new PgDialect();
const user = (id, archived = false) => ({ id, role: 'employee', department: 'HR', archivedAt: archived ? new Date() : null });

function fixture({ role = 'admin', rows = [user('a'), user('b')], missingIdentity = false, pending = false, failAudit = false, failDelete = false } = {}) {
  let state = {
    users: structuredClone(rows), identities: rows.filter(row => !missingIdentity || row.id !== 'b').map(row => ({ id: row.id, name: row.id.toUpperCase(), email: `${row.id}@example.test` })),
    sessions: rows.map(row => ({ userId: row.id })), accounts: rows.map(row => ({ userId: row.id })), grants: rows.map(row => ({ userId: row.id })),
    requests: [{ userId: 'a', budget: '20000' }], audits: [], pending: pending ? [{ userId: 'b', status: 'pending' }] : [],
  };
  let transactions = 0;
  const database = getState => ({
    select: () => ({ from: table => {
      let predicate = () => true;
      const chain = { where: value => { predicate = value; return chain; }, orderBy: () => chain, for: async () => getState()[table.table].filter(predicate) };
      return chain;
    } }),
    update: table => ({ set: patch => ({ where: async predicate => { getState()[table.table] = getState()[table.table].map(row => predicate(row) ? { ...row, ...patch } : row); } }) }),
    delete: table => ({ where: async predicate => { getState()[table.table] = getState()[table.table].filter(row => !predicate(row)); } }),
    insert: table => ({ values: async value => { if (failAudit) throw new Error('Audit failed'); getState()[table.table].push(value); } }),
    execute: async query => {
      const { sql: text, params } = dialect.sqlToQuery(query);
      if (text.startsWith('SELECT id, name, email')) return { rows: getState().identities.filter(row => params.includes(row.id)) };
      if (failDelete && params[0] === 'b') throw new Error('Delete failed');
      const key = text.includes('neon_auth.session') ? 'sessions' : text.includes('neon_auth.account') ? 'accounts' : 'identities';
      getState()[key] = getState()[key].filter(row => (row.id ?? row.userId) !== params[0]);
      return { rows: [] };
    },
  });
  const dependencies = {
    getCurrentAccess: async () => role ? { role, userId: 'admin' } : null,
    unauthorized: { success: false, error: 'Forbidden' }, users, roleApprovalRequests, mcpOAuthGrants, auditLogs, eq, and, inArray, sql,
    getActorSnapshot: async () => ({ actorId: 'admin', actorName: 'Admin', actorEmail: null }),
    withTransaction: async run => {
      transactions++;
      const working = structuredClone(state);
      const result = await run(database(() => working));
      state = working;
      return result;
    },
    console: { error() {} },
  };
  const actions = new Function(...Object.keys(dependencies), code + '; return { bulkManageDirectoryUsers, getManageUserOptions };')(...Object.values(dependencies));
  return { ...actions, state: () => state, transactions: () => transactions };
}
const archive = { userIds: ['a', 'b'], action: 'archive' };

test('non-Admins cannot list or manage users', async () => {
  for (const role of [null, 'employee', 'employee-department', 'viewer', 'viewer-full']) {
    const f = fixture({ role });
    assert.equal((await f.getManageUserOptions(false)).success, false);
    assert.equal((await f.bulkManageDirectoryUsers(archive)).success, false);
    assert.equal(f.transactions(), 0);
  }
});

test('invalid batches and self-selection are rejected before opening a transaction', async () => {
  for (const input of [null, {}, { ...archive, userIds: [] }, { ...archive, userIds: ['a', 'a'] }, { ...archive, userIds: [1] }, { ...archive, userIds: [' '] }, { ...archive, userIds: ['admin'] }, { ...archive, userIds: ['a', 'admin'] }, { ...archive, action: 'move' }, { ...archive, userIds: Array.from({ length: 501 }, (_, i) => String(i)) }]) {
    const f = fixture();
    assert.equal((await f.bulkManageDirectoryUsers(input)).success, false);
    assert.equal(f.transactions(), 0);
  }
});

test('bulk archive preserves identities and business records and audits every target', async () => {
  const f = fixture({ rows: [user('a'), user('b'), user('c')] });
  const before = structuredClone(f.state());
  assert.equal((await f.bulkManageDirectoryUsers(archive)).success, true);
  assert.ok(f.state().users[0].archivedAt);
  assert.ok(f.state().users[1].archivedAt);
  assert.equal(f.state().users[2].archivedAt, null);
  assert.deepEqual(f.state().identities, before.identities);
  assert.deepEqual(f.state().requests, before.requests);
  assert.deepEqual(f.state().audits.map(audit => [audit.action, audit.entityId]), [['archived', 'a'], ['archived', 'b']]);
});

test('missing accounts, pending approvals, and stale archive states reject all targets', async () => {
  for (const options of [{ rows: [user('a')] }, { missingIdentity: true }, { pending: true }, { rows: [user('a'), user('b', true)] }]) {
    const f = fixture(options);
    const before = structuredClone(f.state());
    assert.equal((await f.bulkManageDirectoryUsers(archive)).success, false);
    assert.deepEqual(f.state(), before);
  }
});

test('permanent deletion requires every target to be archived', async () => {
  const f = fixture({ rows: [user('a', true), user('b')] });
  const before = structuredClone(f.state());
  assert.equal((await f.bulkManageDirectoryUsers({ ...archive, action: 'delete' })).success, false);
  assert.deepEqual(f.state(), before);
});

test('bulk delete removes authentication and grants while retaining archived app identities and requests', async () => {
  const f = fixture({ rows: [user('a', true), user('b', true), user('c')] });
  const before = structuredClone(f.state());
  assert.equal((await f.bulkManageDirectoryUsers({ ...archive, action: 'delete' })).success, true);
  for (const key of ['identities', 'sessions', 'accounts', 'grants']) {
    assert.equal(f.state()[key].length, 1);
    assert.equal(f.state()[key][0].id ?? f.state()[key][0].userId, 'c');
  }
  assert.deepEqual(f.state().users, before.users);
  assert.deepEqual(f.state().requests, before.requests);
  assert.deepEqual(f.state().audits.map(audit => [audit.action, audit.entityId, audit.details.permanentlyDeleted]), [['deleted', 'a', true], ['deleted', 'b', true]]);
});

test('audit and authentication deletion failures roll back the entire batch', async () => {
  for (const options of [{ failAudit: true }, { failDelete: true, rows: [user('a', true), user('b', true)] }]) {
    const f = fixture(options);
    const before = structuredClone(f.state());
    assert.equal((await f.bulkManageDirectoryUsers({ ...archive, action: options.failDelete ? 'delete' : 'archive' })).success, false);
    assert.deepEqual(f.state(), before);
  }
});
