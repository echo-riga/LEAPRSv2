import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/actions.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true);
const actionNames = ['getCapdevFolders', 'saveCapdevFolder', 'deleteCapdevFolder', 'markCapdevFolderActive', 'bulkManageCapdevs', 'saveCapdevFolderReferenceImage', 'removeCapdevFolderReferenceImage'];
const forbidden = { success: false, error: 'Forbidden' };

test('folder listing, creation, renaming, deletion, and activation reject every non-Admin role before database access', async () => {
  for (const name of actionNames) {
    const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, name + ' exists');
    const executable = ts.transpileModule(node.getText(file).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    for (const role of [null, 'employee', 'employee-department', 'viewer', 'viewer-full']) {
      const getCurrentAccess = async () => role ? { userId: 'test', role, department: 'Test' } : null;
      const action = new Function('getCurrentAccess', 'unauthorized', executable + '; return ' + name)(getCurrentAccess, forbidden);
      const result = name === 'saveCapdevFolder' ? await action('Draft', 1) : await action(1);
      assert.equal(result.success, false, name + ' denied ' + role);
      assert.equal(result.error, 'Forbidden');
      if (name === 'getCapdevFolders') assert.deepEqual(result.folders, []);
    }
  }
});

function routeFunction(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Page');
  assert.ok(node);
  const code = ts.transpileModule(node.getText(file).replace(/^export default /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return new Function(...Object.keys(dependencies), code + '; return Page;')(...Object.values(dependencies));
}
const redirect = destination => { throw Object.assign(new Error('Redirect'), { destination }); };
const React = { createElement: (component, props) => ({ component, props }) };

test('legacy folder-management route redirects every role to the project page', () => {
  for (const role of ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full']) {
    const page = routeFunction('../src/app/portal/folders/page.tsx', { connection: async () => {}, getCurrentUserAccess: async () => ({ success: true, role }), redirect, React, FoldersPage: 'folders' });
    assert.throws(() => page(), error => error.destination === '/portal');
  }
});

test('project route admits only the selected active folder for every role', async () => {
  for (const role of ['admin','employee','employee-department','viewer','viewer-full']) {
    const page = routeFunction('../src/app/portal/folders/[folderId]/page.tsx', { getPortalContext: async () => ({ success: true, role, activeFolder: { id: 4, name: 'Active' } }), notFound: () => { throw new Error('Not found'); }, redirect, React, CapdevPage: 'projects' });
    assert.equal((await page({ params: Promise.resolve({ folderId: '4' }) })).props.folderId, 4);
    await assert.rejects(page({ params: Promise.resolve({ folderId: '99' }) }), error => error.destination === '/portal');
  }
});
