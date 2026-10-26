import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { validateMoney } from '../src/lib/request-validation.ts';
import { auditChanges } from '../src/lib/audit-description.ts';

const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const action = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'updateCapdev');
const code = ts.transpileModule(action.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const base = { id: 1, folderId: 1, aipCode: '2026-001-1-1-01-001-001', description: '', department: 'Test', initialBudget: '10000.00', budget: '7000.00', archivedAt: null, additionalInfo: {} };
const input = { ...base, updatedById: 'admin' };
function fixture({ role = 'admin', locked = {}, existing = {} } = {}) {
  let current = { ...base, ...locked };
  let patch;
  let audit;
  let transactionCount = 0;
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => [{ ...current }] }) }) }),
    update: () => ({ set: values => { patch = values; return { where: () => ({ returning: async () => { current = { ...current, ...values }; return [current]; } }) }; } }),
  };
  const deps = {
    getCurrentAccess: async () => ({ role, userId: 'admin' }), unauthorized: { success: false, error: 'Denied' }, validateMoney,
    validatePendingAttachments: value => value, validateComboboxValues: async () => null, getMissingRequiredCapdevFields: async () => [],
    db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ...base, ...existing }] }) }) }) },
    capdevs: {}, eq: () => true, ARCHIVED_READ_ONLY: 'Archived',
    withTransaction: async run => { transactionCount++; return run(tx); }, lockCapdevFolder: async () => {},
    reconcilePendingAttachments: value => value, auditChanges, getCapdevFieldDefinitions: async () => [],
    lockDriveAttachments: async () => {}, assertAttachmentsNotDeleted: async () => {}, enqueueRemovedAttachments: async () => {}, scheduleDriveCleanup: () => {},
    getDynamicFieldValue: () => undefined, writeAuditLog: async (_, entry) => { audit = entry; },
  };
  const update = new Function(...Object.keys(deps), code + '; return updateCapdev;')(...Object.values(deps));
  return { update, patch: () => patch, audit: () => audit, transactions: () => transactionCount, setCurrent: value => { current = { ...current, ...value }; } };
}

test('changing initial budget resets remaining budget and audits both locked balances', async () => {
  const f = fixture({ locked: { budget: '6000.00' } });
  const result = await f.update(1, { ...input, initialBudget: '12000' });
  assert.equal(result.success, true);
  assert.equal(result.capdev.initialBudget, '12000');
  assert.equal(result.capdev.budget, '12000');
  assert.deepEqual(f.audit().details.changes.filter(change => /Budget|budget/.test(change.field)), [
    { field: 'initialBudget', label: 'Initial Balance', from: '10000.00', to: '12000' },
    { field: 'budget', label: 'Remaining Balance', from: '6000.00', to: '12000' },
  ]);
});

test('ordinary stale form saves preserve current initial and remaining balances', async () => {
  const f = fixture({ locked: { initialBudget: '20000.00', budget: '15000.00' } });
  const result = await f.update(1, { ...input, initialBudget: undefined, description: 'Updated title' });
  assert.equal(result.capdev.initialBudget, '20000.00');
  assert.equal(result.capdev.budget, '15000.00');
  assert.equal(Object.hasOwn(f.patch(), 'budget'), false);
});

test('same amount and a repeated reset submission preserve deductions made after resetting', async () => {
  const f = fixture();
  const unchanged = await f.update(1, { ...input, initialBudget: '10000' });
  assert.equal(unchanged.capdev.budget, '7000.00');
  await f.update(1, { ...input, initialBudget: '12000' });
  f.setCurrent({ budget: '9000.00' });
  const retry = await f.update(1, { ...input, initialBudget: '12000.00' });
  assert.equal(retry.capdev.budget, '9000.00');
  assert.equal(Object.hasOwn(f.patch(), 'budget'), false);
});

test('zero initial budget resets both balances and still requires positive request amounts', async () => {
  const f = fixture();
  const result = await f.update(1, { ...input, initialBudget: '0' });
  assert.equal(result.success, true);
  assert.equal(result.capdev.initialBudget, '0');
  assert.equal(result.capdev.budget, '0');
  assert.throws(() => validateMoney('0'));
});

test('invalid budgets are rejected before writes', async () => {
  for (const initialBudget of ['-1', '1.234', '1.50', 'NaN', 'Infinity', '1e4', '', '10000000000']) {
    const f = fixture();
    assert.equal((await f.update(1, { ...input, initialBudget })).success, false);
    assert.equal(f.transactions(), 0);
  }
});

test('non-Admins and archived projects cannot reset budgets', async () => {
  for (const role of ['employee','employee-department','viewer','viewer-full']) {
    const f = fixture({ role });
    assert.equal((await f.update(1, { ...input, initialBudget: '12000' })).success, false);
    assert.equal(f.transactions(), 0);
  }
  const f = fixture({ existing: { archivedAt: new Date() } });
  assert.equal((await f.update(1, { ...input, initialBudget: '12000' })).success, false);
  assert.equal(f.transactions(), 0);
});
