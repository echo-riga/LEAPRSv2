import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadDeletionHelpers() {
  const source = (await readFile(new URL('../src/lib/dynamic-field-deletion.ts', import.meta.url), 'utf8'))
    .replace("import { dynamicFieldStorageKey, type DynamicFieldIdentity } from './dynamic-fields';", "const dynamicFieldStorageKey = field => `field:${field.id}`;");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { getDynamicFieldAttachmentIds, hasStoredDynamicFieldValue, removeDynamicFieldValue } = await loadDeletionHelpers();
const field = { id: 49, name: 'File Upload (Allows Multiple Uploads)' };

test('field deletion finds completed attachments in canonical and legacy values', () => {
  const info = {
    'field:49': [{ id: 'canonical-file' }, { pendingUploadId: 'pending-file', pending: true }],
    [field.name]: [{ id: 'legacy-file' }, { id: 'canonical-file' }],
  };
  assert.deepEqual(getDynamicFieldAttachmentIds(info, field), ['canonical-file', 'legacy-file']);
});

test('field deletion removes canonical and legacy values but preserves unrelated data', () => {
  const info = { 'field:49': [{ id: 'file' }], [field.name]: [{ id: 'legacy' }], department: 'IT' };
  assert.equal(hasStoredDynamicFieldValue(info, field), true);
  assert.deepEqual(removeDynamicFieldValue(info, field), { department: 'IT' });
  assert.equal(info['field:49'][0].id, 'file');
});

test('renamed fields only remove their stable identity and current legacy label', () => {
  const info = { 'field:49': 'current', 'Old field name': 'unrelated legacy value' };
  assert.deepEqual(removeDynamicFieldValue(info, { id: 49, name: 'Renamed field' }), { 'Old field name': 'unrelated legacy value' });
});
