import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getPasswordValidationError } from '../src/lib/password-validation.ts';
import { auditChanges } from '../src/lib/audit-description.ts';

// Execute the actual action with isolated auth/database dependencies.
const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const action = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'updateDirectoryUser');
assert.ok(action);
const compiled = ts.transpileModule(action.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const dependencies = ['getCurrentAccess', 'VALID_ROLES', 'unauthorized', 'getPasswordValidationError', 'db', 'users', 'eq', 'fetchAuthUsersList', 'ARCHIVED_READ_ONLY', 'auth', 'writeAuditLog', 'auditChanges'];
const makeAction = new Function(...dependencies, compiled + '\nreturn updateDirectoryUser;');
const input = { name: 'Employee', email: 'employee@example.test', role: 'employee', department: 'Training' };

function harness({ role = 'admin', archived = false, passwordError = null, passwordData = { success: true } } = {}) {
  const calls = { profiles: [], passwords: [], writes: [], audits: [] };
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ role: 'employee', department: 'Training', archivedAt: archived ? new Date() : null }] }) }) }),
    update: () => ({ set: (value) => ({ where: async () => { calls.writes.push(value); } }) }),
  };
  const auth = { admin: {
    updateUser: async (payload) => { calls.profiles.push(payload); return { error: null }; },
    setUserPassword: async (payload) => { calls.passwords.push(payload); return { data: passwordData, error: passwordError }; },
  } };
  const values = {
    getCurrentAccess: async () => role ? { userId: 'admin-id', role } : null,
    VALID_ROLES: ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full'],
    unauthorized: { success: false, error: 'Unauthorized' }, getPasswordValidationError,
    db, users: { id: 'id' }, eq: () => true,
    fetchAuthUsersList: async () => [{ id: 'employee-id', name: input.name, email: input.email }],
    ARCHIVED_READ_ONLY: 'Archived records are read-only.', auth,
    writeAuditLog: async (_, entry) => { calls.audits.push(entry); }, auditChanges,
  };
  return { calls, save: makeAction(...dependencies.map((name) => values[name])) };
}

test('password edit updates the authentication credential and never exposes it in audit history', async () => {
  const { calls, save } = harness();
  const password = 'new-test-password';
  assert.equal((await save('employee-id', { ...input, password })).success, true);
  assert.deepEqual(calls.passwords, [{ userId: 'employee-id', newPassword: password }]);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.audits[0].details.passwordChanged, true);
  assert.ok(!JSON.stringify(calls.audits).includes(password));
});

test('blank or omitted password preserves the existing authentication credential', async () => {
  for (const password of [undefined, '']) {
    const { calls, save } = harness();
    assert.equal((await save('employee-id', { ...input, password })).success, true);
    assert.equal(calls.passwords.length, 0);
  }
});

test('invalid passwords are rejected before changing profile or credentials', async () => {
  for (const password of ['short', 'x'.repeat(129), 12345678]) {
    const { calls, save } = harness();
    assert.equal((await save('employee-id', { ...input, password })).success, false);
    assert.equal(calls.profiles.length, 0);
    assert.equal(calls.passwords.length, 0);
  }
});

test('authentication failures are returned without reporting a successful password change', async () => {
  for (const failure of [{ passwordError: { message: 'Password rejected' } }, { passwordData: null }]) {
    const { calls, save } = harness(failure);
    const result = await save('employee-id', { ...input, password: 'new-test-password' });
    assert.equal(result.success, false);
    assert.match(result.error, /password/i);
    assert.equal(calls.writes.length, 0);
    assert.equal(calls.audits.length, 0);
  }
});

test('non-admin and archived-user edits cannot change passwords', async () => {
  for (const options of [{ role: null }, { role: 'employee' }, { archived: true }]) {
    const { calls, save } = harness(options);
    assert.equal((await save('employee-id', { ...input, password: 'new-test-password' })).success, false);
    assert.equal(calls.profiles.length, 0);
    assert.equal(calls.passwords.length, 0);
  }
});

const userSource = readFileSync(new URL('../src/app/portal/users/page.tsx', import.meta.url), 'utf8');
const userAst = ts.createSourceFile('users.tsx', userSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function findHandler(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(userAst) === 'handleSaveUser') handler = node;
  ts.forEachChild(node, findHandler);
}
findHandler(userAst);
assert.ok(handler);
const handlerCode = ts.transpileModule('const ' + handler.getText(userAst) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const handlerDependencies = ['showArchived', 'editingUser', 'formName', 'formEmail', 'formRole', 'formDepartment', 'formPassword', 'setFormEmailError', 'focusFormError', 'getPasswordValidationError', 'setFormPasswordError', 'setFormError', 'updateDirectoryUser', 'getFriendlyPasswordError', 'setFormNameError', 'showUserFormError', 'setUsersList', 'setDialogOpen'];
const makeHandler = new Function(...handlerDependencies, handlerCode + '\nreturn handleSaveUser;');

test('edit form sends the new password to the server and keeps the displayed password masked', async () => {
  const payloads = [];
  const editingUser = { id: 'employee-id', ...input, isMock: false };
  let displayedUsers = [editingUser];
  let dialogClosed = false;
  const values = {
    showArchived: false, editingUser, formName: input.name, formEmail: input.email,
    formRole: input.role, formDepartment: input.department, formPassword: 'new-test-password',
    setFormEmailError: () => {}, focusFormError: () => {}, getPasswordValidationError,
    setFormPasswordError: () => {}, setFormError: () => {},
    updateDirectoryUser: async (userId, payload) => { payloads.push({ userId, payload }); return { success: true }; },
    getFriendlyPasswordError: (message) => message, setFormNameError: () => {}, showUserFormError: () => {},
    setUsersList: (update) => { displayedUsers = update(displayedUsers); },
    setDialogOpen: (open) => { dialogClosed = !open; },
  };
  const save = makeHandler(...handlerDependencies.map((name) => values[name]));
  await save();
  assert.equal(payloads[0].userId, editingUser.id);
  assert.equal(payloads[0].payload.password, values.formPassword);
  assert.equal(displayedUsers[0].password, '••••••••');
  assert.equal(dialogClosed, true);
});
