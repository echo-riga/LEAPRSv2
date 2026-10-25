import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isArchiveReadOnly } from '../src/lib/archive-policy.ts';
import { requestLabel } from '../src/lib/audit-description.ts';

const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const names = ['canManageRequests', 'getManageRequestOptions', 'bulkManageRequests'];
const code = names.map(name => ts.transpileModule(ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).join('\n');
const table = (name, keys) => Object.fromEntries([['table', name], ...keys.map(key => [key, { key }])]);
const requests = table('requests', ['id', 'capdevId', 'userId', 'archivedAt', 'createdAt']);
const capdevs = table('capdevs', ['id']);
const auditLogs = table('auditLogs', []);
const eq = (column, value) => row => row[column.key] === value;
const inArray = (column, values) => row => values.includes(row[column.key]);
const and = (...conditions) => row => conditions.filter(Boolean).every(condition => condition(row));
const isNull = column => row => row[column.key] == null;
const isNotNull = column => row => row[column.key] != null;
const row = (id, overrides = {}) => ({ id, capdevId: 1, userId: 'owner', requestorName: `Person ${id}`, description: `Title ${id}`, archivedAt: null, createdAt: '2026-10-25', ...overrides });

function fixture({ role = 'admin', rows = [row(1), row(2)], parentArchived = false, accessible = true, active = true, failDelete = false, failAudit = false } = {}) {
  let state = { requests: structuredClone(rows), capdevs: [{ id: 1, folderId: 1, aipCode: 'AIP', archivedAt: parentArchived ? new Date() : null, budget: '20000' }], auditLogs: [] };
  const calls = { transactions: 0, cleanup: [], deletions: [], scopeChecks: 0 };
  const database = getState => ({
    select: () => ({ from: table => {
      let predicate = () => true;
      const result = () => getState()[table.table].filter(predicate);
      const chain = { where: condition => { predicate = condition; return chain; }, orderBy: () => chain, for: async () => result(), then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
      return chain;
    } }),
    update: table => ({ set: patch => ({ where: async predicate => { getState()[table.table] = getState()[table.table].map(row => predicate(row) ? { ...row, ...patch } : row); } }) }),
    insert: table => ({ values: async value => { if (failAudit) throw new Error('Audit failed'); getState()[table.table].push(value); } }),
  });
  const dependencies = {
    getCurrentAccess: async () => role ? { role, userId: 'owner' } : null,
    getAccessibleCapdev: async () => accessible ? state.capdevs[0] : null,
    getActorSnapshot: async () => ({ actorId: 'owner', actorName: 'Owner', actorEmail: null }),
    unauthorized: { success: false, error: 'Forbidden' }, requests, capdevs, auditLogs, eq, and, inArray, isNull, isNotNull, isArchiveReadOnly, requestLabel,
    assertActiveFolderAccess: async (_, role) => { calls.scopeChecks++; if (role !== 'admin' && !active) throw new Error('Folder no longer active'); },
    cleanupRequestStorage: async (_, ids) => { calls.cleanup.push(ids); },
    deleteRequestRecords: async (tx, id) => {
      calls.deletions.push(id);
      if (failDelete && id === 2) return { rows: [] };
      tx.state.requests = tx.state.requests.filter(row => row.id !== id);
      tx.state.auditLogs.push({ action: 'deleted', entityId: String(id) });
      return { rows: [{ id }] };
    },
    db: database(() => state),
    withTransaction: async run => {
      calls.transactions++;
      const working = structuredClone(state);
      const result = await run({ ...database(() => working), state: working });
      state = working;
      return result;
    },
    console: { error() {} },
  };
  const actions = new Function(...Object.keys(dependencies), code + '; return { bulkManageRequests, getManageRequestOptions };')(...Object.values(dependencies));
  return { ...actions, state: () => state, calls };
}
const archive = { capdevId: 1, requestIds: [1, 2], action: 'archive' };

test('Viewers and signed-out callers cannot list or mutate bulk request options', async () => {
  for (const role of [null, 'viewer', 'viewer-full']) {
    const f = fixture({ role });
    assert.equal((await f.getManageRequestOptions(1, false)).success, false);
    assert.equal((await f.bulkManageRequests(archive)).success, false);
    assert.equal(f.calls.transactions, 0);
  }
});

test('options span pages but preserve CapDev, archive, and Employee ownership scope', async () => {
  const rows = Array.from({ length: 9 }, (_, index) => row(index + 1));
  rows.push(row(20, { capdevId: 2 }), row(21, { archivedAt: new Date() }), row(22, { userId: 'someone-else' }));
  const own = fixture({ role: 'employee', rows });
  assert.equal((await own.getManageRequestOptions(1, false)).records.length, 9);
  assert.deepEqual((await own.getManageRequestOptions(1, true)).records.map(row => row.id), [21]);
  const all = fixture({ role: 'employee-department', rows });
  assert.equal((await all.getManageRequestOptions(1, false)).records.length, 10);
  assert.equal((await fixture({ accessible: false }).getManageRequestOptions(1, false)).success, false);
});

test('malformed, empty, duplicate, and oversized selections fail before transactions', async () => {
  for (const input of [null, {}, { ...archive, requestIds: [] }, { ...archive, requestIds: [1, 1] }, { ...archive, requestIds: [-1] }, { ...archive, requestIds: ['1'] }, { ...archive, requestIds: Array.from({ length: 501 }, (_, i) => i + 1) }, { ...archive, action: 'move' }]) {
    const f = fixture();
    assert.equal((await f.bulkManageRequests(input)).success, false);
    assert.equal(f.calls.transactions, 0);
  }
});

test('Admin, cross-department Employee, and owner archive selected records with individual audits and no budget change', async () => {
  for (const role of ['admin', 'employee-department', 'employee']) {
    const f = fixture({ role, rows: [row(1), row(2), row(3)] });
    assert.equal((await f.bulkManageRequests(archive)).success, true);
    assert.ok(f.state().requests[0].archivedAt);
    assert.ok(f.state().requests[1].archivedAt);
    assert.equal(f.state().requests[2].archivedAt, null);
    assert.deepEqual(f.state().auditLogs.map(row => [row.action, row.entityId]), [['archived', '1'], ['archived', '2']]);
    assert.equal(f.state().capdevs[0].budget, '20000');
    assert.equal(f.calls.scopeChecks, 1);
  }
});

test('missing, foreign, stale, or newly inaccessible selections reject the entire batch before cleanup', async () => {
  for (const options of [{ rows: [row(1)] }, { rows: [row(1), row(2, { capdevId: 2 })] }, { role: 'employee', rows: [row(1), row(2, { userId: 'other' })] }, { rows: [row(1), row(2, { archivedAt: new Date() })] }, { parentArchived: true }, { role: 'employee', active: false }, { accessible: false }]) {
    const f = fixture(options);
    const before = structuredClone(f.state());
    assert.equal((await f.bulkManageRequests(archive)).success, false);
    assert.deepEqual(f.state(), before);
    assert.deepEqual(f.calls.cleanup, []);
  }
});

test('permanent deletion requires every target or its parent to be archived and never refunds deductions', async () => {
  const invalid = fixture({ rows: [row(1, { archivedAt: new Date() }), row(2)] });
  assert.equal((await invalid.bulkManageRequests({ ...archive, action: 'delete' })).success, false);
  assert.deepEqual(invalid.calls.cleanup, []);
  for (const options of [{ rows: [row(1, { archivedAt: new Date() }), row(2, { archivedAt: new Date() })] }, { parentArchived: true }]) {
    const f = fixture(options);
    assert.equal((await f.bulkManageRequests({ ...archive, action: 'delete' })).success, true);
    assert.equal(f.state().requests.length, 0);
    assert.deepEqual(f.calls.cleanup, [[1, 2]]);
    assert.deepEqual(f.calls.deletions, [1, 2]);
    assert.equal(f.state().auditLogs.length, 2);
    assert.equal(f.state().capdevs[0].budget, '20000');
  }
});

test('database failures roll back the whole archive/delete batch', async () => {
  for (const options of [{ failAudit: true }, { parentArchived: true, failDelete: true }]) {
    const f = fixture(options);
    const before = structuredClone(f.state());
    assert.equal((await f.bulkManageRequests({ ...archive, action: options.failDelete ? 'delete' : 'archive' })).success, false);
    assert.deepEqual(f.state(), before);
  }
});
