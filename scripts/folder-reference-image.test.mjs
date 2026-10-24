import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { validateFolderReferenceImage, MAX_REFERENCE_IMAGE_BYTES } from '../src/lib/folder-reference-image.ts';

const png = () => new File([new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0])], 'paper.png', { type: 'image/png' });
const stored = { id: 'old', name: 'paper.png', mimeType: 'image/png', rootFolderId: 'root', version: 'old-version' };
function compile(path, name, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const node = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name);
  const code = ts.transpileModule(node.getText(file).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), code + ';return ' + name)(...Object.values(dependencies));
}

test('reference images accept supported signatures and reject empty, oversized, mismatched, and executable files', async () => {
  for (const file of [new File(['%PDF-1.7\n'], 'paper.pdf', { type: 'application/pdf' }), png(), new File([new Uint8Array([255,216,255,0])], 'paper.jpg', { type: 'image/jpeg' }), new File(['RIFF0000WEBP'], 'paper.webp', { type: 'image/webp' })]) assert.equal(await validateFolderReferenceImage(file), file);
  for (const file of [new File(['not a PDF'], 'fake.pdf', { type: 'application/pdf' }), null, 'not a file', new File([], 'empty.png', { type: 'image/png' }), new File([new Uint8Array(MAX_REFERENCE_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' }), new File(['<svg/>'], 'paper.svg', { type: 'image/svg+xml' }), new File(['<script>alert(1)</script>'], 'fake.png', { type: 'image/png' })]) await assert.rejects(validateFolderReferenceImage(file));
});

test('reference metadata is scoped to live folder access for all roles', async () => {
  for (const role of ['admin','employee','employee-department','viewer','viewer-full',null]) {
    for (const isActive of [true,false]) {
      const get = compile('../src/app/actions.ts', 'getCapdevFolderReferenceImage', {
        getCurrentAccess: async () => role ? { role } : null,
        unauthorized: { success: false, error: 'Denied' }, capdevFolders: {}, eq: () => true,
        db: { select: () => ({ from: () => ({ where: async () => [{ isActive, referenceImage: stored }] }) }) },
      });
      const result = await get(3);
      assert.equal(result.success, Boolean(role && (role === 'admin' || isActive)));
      if (result.success) assert.equal(result.image.id, 'old');
      else assert.equal('image' in result, false);
    }
  }
});

test('replacing an image commits the new descriptor before cleaning the old file; a failed save preserves the old reference', async () => {
  for (const fail of [false,true]) {
    const cleaned = [];
    let image = stored;
    const action = compile('../src/app/actions.ts', 'saveCapdevFolderReferenceImage', {
      getCurrentAccess: async () => ({ role: 'admin', userId: 'admin' }), unauthorized: { success: false }, validateFolderReferenceImage,
      getActorSnapshot: async () => ({ actorId: 'admin' }), lockCapdevFolder: async () => ({ name: 'Folder', referenceImage: stored }),
      getActiveGoogleStorage: async () => ({rootFolderId:'root'}), getGoogleDriveAccessToken: async () => 'test-token', process: { env: { GOOGLE_DRIVE_PARENT_FOLDER_ID: 'root' } },
      uploadFileToGoogleDrive: async () => ({ id: 'new' }), crypto: { randomUUID: () => 'new-version' }, capdevFolders: {}, auditLogs: {}, eq: () => true,
      withTransaction: async run => run({ update: () => ({ set: value => { if (fail) throw new Error('save failed'); image = value.referenceImage; return { where: async () => {} }; } }), insert: () => ({ values: async () => {} }) }),
      cleanupFolderReferenceImage: async value => { cleaned.push(value.id); if (!fail) assert.equal(image.id, 'new'); }, console: { error: () => {} },
    });
    const form = new FormData(); form.set('image', png());
    const result = await action(3, form);
    assert.equal(result.success, !fail);
    assert.equal(image.id, fail ? 'old' : 'new');
    assert.deepEqual(cleaned, [fail ? 'new' : 'old']);
  }
});

test('image endpoint enforces access before fetching Drive bytes and sends private non-cacheable image content', async () => {
  for (const result of [{ success: false }, { success: true, image: null }, { success: true, image: stored }, { success: true, image: { ...stored, name: 'paper.pdf', mimeType: 'application/pdf' } }]) {
    let fetched = false;
    const get = compile('../src/app/api/capdev-folders/[folderId]/reference-image/route.ts', 'GET', {
      getCapdevFolderReferenceImage: async () => result, getGoogleDriveAccessToken: async () => 'test-token',
      fetch: async () => { fetched = true; return new Response(new Uint8Array([1,2,3])); },
    });
    const response = await get(new Request('https://example.test/image'), { params: Promise.resolve({ folderId: '3' }) });
    assert.equal(response.status, !result.success ? 403 : !result.image ? 404 : 200);
    assert.equal(fetched, Boolean(result.success && result.image));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    if (response.status === 200) { assert.equal(response.headers.get('content-type'), result.image.mimeType); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); }
  }
});
