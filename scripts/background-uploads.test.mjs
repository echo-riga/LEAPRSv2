import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { BackgroundUploadQueue } = await load('../src/lib/background-upload-queue.ts');
const { stageAttachments, validatePendingAttachments, replacePendingAttachment, reconcilePendingAttachments } = await load('../src/lib/background-attachments.ts');
const file = () => new File(['test'], 'test.txt', { type: 'text/plain' });
const target = { kind: 'request', id: 1 };
const until = async condition => { for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Queue did not settle.'); };

function storage() {
  const rows = new Map();
  return { rows, save: async (job, onlyIfMissing) => {
    if (!onlyIfMissing || !rows.has(job.uploadId)) rows.set(job.uploadId, { ...job });
  }, load: async () => [...rows.values()].map(job => ({ ...job })), exclusive: async run => run() };
}

test('reload restores file bytes and checkpoints without retransferring an uploaded file', async () => {
  const saved = storage();
  let uploaded = 0;
  let reached;
  const ready = new Promise(resolve => { reached = resolve; });
  const first = new BackgroundUploadQueue(async (job, _, signal, checkpoint) => {
    uploaded++;
    job.fileId = 'already-in-drive';
    await checkpoint();
    reached();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Tab closed'))));
  }, () => {}, async () => {}, saved);
  first.enqueue(target, '', stageAttachments({}, { files: [file(), file()] }).jobs);
  await ready;
  first.stop();
  await new Promise(resolve => setTimeout(resolve, 0));
  let attached = 0;
  const restored = new BackgroundUploadQueue(async job => {
    assert.equal(job.file.size, 4);
    if (!job.fileId) uploaded++;
    attached++;
  }, () => {}, async () => {}, saved);
  restored.start();
  await until(() => attached === 2 && !restored.unfinished);
  assert.equal(uploaded, 2);
  const again = new BackgroundUploadQueue(async () => { throw new Error('Completed jobs must not run'); }, () => {}, async () => {}, saved);
  again.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(again.jobs.length, 0);
});

test('removed records cancel their saved upload and release its file bytes', async () => {
  const saved = storage();
  const queue = new BackgroundUploadQueue(async job => { job.status = 'cancelled'; }, () => {}, async () => {}, saved);
  queue.enqueue(target, '', stageAttachments({}, { files: [file()] }).jobs);
  await until(() => !queue.unfinished);
  assert.equal(queue.jobs[0].status, 'cancelled');
  assert.equal([...saved.rows.values()][0].file.size, 0);
});

test('storage failure preserves the selected bytes and stops remote upload', async () => {
  const saved = storage();
  saved.save = async () => { throw new Error('Storage full'); };
  let transferred = false;
  const queue = new BackgroundUploadQueue(async () => { transferred = true; }, () => {}, async () => {}, saved);
  queue.enqueue(target, '', stageAttachments({}, { files: [file()] }).jobs);
  await until(() => !!queue.storageError);
  assert.equal(transferred, false);
  assert.equal(queue.jobs[0].file.size, 4);
  assert.equal(queue.jobs[0].status, 'failed');
});

test('enqueue returns while upload is pending and processes one job at a time', async () => {
  let release;
  let active = 0;
  let maximum = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new BackgroundUploadQueue(async () => { active++; maximum = Math.max(maximum, active); await gate; active--; }, () => {});
  const { jobs } = stageAttachments({}, { files: [file(), file()] });
  queue.enqueue(target, 'Requestor', jobs);
  await until(() => queue.jobs[0].status === 'uploading');
  assert.equal(queue.jobs[0].status, 'uploading');
  assert.equal(queue.jobs[1].status, 'pending');
  assert.equal(queue.unfinished, true);
  release();
  await until(() => !queue.unfinished);
  assert.equal(maximum, 1);
  assert.ok(queue.jobs.every(job => job.file.size === 0));
});

test('failed metadata persistence retries the same uploaded file without creating another record', async () => {
  let uploads = 0;
  let saves = 0;
  const queue = new BackgroundUploadQueue(async job => {
    if (!job.fileId) { uploads++; job.fileId = 'drive-file'; }
    if (++saves === 1) throw new Error('Database unavailable');
  }, () => {}, async () => {});
  queue.enqueue(target, 'Requestor', stageAttachments({}, { files: [file()] }).jobs);
  await until(() => !queue.unfinished);
  assert.equal(uploads, 1);
  assert.equal(saves, 2);
  assert.equal(queue.jobs[0].attempts, 2);
});

test('failed job exhausts retries, preserves bytes, and does not block other jobs', async () => {
  let fail = true;
  const queue = new BackgroundUploadQueue(async job => { if (job.fieldKey === 'bad' && fail) throw new Error('Offline'); }, () => {}, async () => {});
  queue.enqueue(target, 'Requestor', stageAttachments({}, { bad: [file()], good: [file()] }).jobs);
  await until(() => queue.jobs[1].status === 'completed');
  assert.equal(queue.jobs[0].status, 'failed');
  assert.equal(queue.jobs[0].attempts, 3);
  assert.equal(queue.jobs[0].file.size, 4);
  fail = false;
  queue.retry(queue.jobs[0].uploadId);
  await until(() => !queue.unfinished);
  assert.equal(queue.jobs[1].attempts, 1);
});

test('stopping the queue aborts transport and does not start waiting files', async () => {
  const queue = new BackgroundUploadQueue(async (_job, _progress, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))), () => {});
  queue.enqueue(target, 'Requestor', stageAttachments({}, { files: [file(), file()] }).jobs);
  queue.stop();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(queue.jobs[1].attempts, 0);
});

test('reselecting an interrupted file reuses its pending descriptor without duplicate queue jobs', async () => {
  const original = stageAttachments({}, { files: [file()] });
  const recovered = stageAttachments(original.additionalInfo, { files: [file()] });
  assert.equal(recovered.jobs[0].uploadId, original.jobs[0].uploadId);
  assert.equal(recovered.additionalInfo.files.length, 1);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queue = new BackgroundUploadQueue(async () => gate, () => {});
  queue.enqueue(target, 'Requestor', original.jobs);
  queue.enqueue(target, 'Requestor', recovered.jobs);
  assert.equal(queue.jobs.length, 1);
  release();
  await until(() => !queue.unfinished);
});

test('staging keeps legacy attachments and non-file fields, and stores no file bytes', () => {
  const old = { id: 'old', name: 'old.pdf', mimeType: 'application/pdf', url: 'https://drive.google.com/open?id=old' };
  const info = { Files: [old], description: 'Keep me' };
  const staged = stageAttachments(info, { 'field:1': [file()] }, [{ id: 1, name: 'Files' }]);
  assert.deepEqual(staged.additionalInfo['field:1'][0], old);
  assert.equal(staged.additionalInfo.description, info.description);
  assert.equal(staged.jobs[0].file.size, 4);
  assert.equal(staged.additionalInfo['field:1'][1].url, undefined);
  assert.equal(info['field:1'], undefined);
  assert.doesNotThrow(() => JSON.stringify(staged.additionalInfo));
});

test('invalid or oversized files fail before a record is saved', () => {
  assert.throws(() => stageAttachments({}, { files: [new File([], 'empty.txt')] }), /invalid/);
  assert.throws(() => stageAttachments({}, { files: Array.from({ length: 11 }, file) }), /10 files/);
  const { additionalInfo } = stageAttachments({}, { files: [file()] });
  additionalInfo.files[0].size = 101 * 1024 * 1024;
  assert.throws(() => validatePendingAttachments(additionalInfo, 'actor'), /100 MB/);
});

test('completion only replaces its own placeholder and preserves another pending upload', () => {
  const staged = stageAttachments({ text: 'Preserved' }, { files: [file(), file()] });
  const validated = validatePendingAttachments(staged.additionalInfo, 'actor');
  assert.equal(validated.files[0].uploadedById, 'actor');
  const attached = { id: 'drive', name: 'test.txt', mimeType: 'text/plain', url: 'https://drive.google.com/open?id=drive', backgroundUploadId: staged.jobs[0].uploadId };
  const updated = replacePendingAttachment(validated, staged.jobs[0].uploadId, attached);
  assert.equal(updated.files[0].id, 'drive');
  assert.equal(updated.files[1].pending, true);
  assert.equal(updated.text, 'Preserved');
  assert.deepEqual(replacePendingAttachment(updated, staged.jobs[0].uploadId, attached), updated);
  const reconciled = reconcilePendingAttachments(validated, updated);
  assert.equal(reconciled.files[0].id, 'drive');
  assert.equal(reconciled.files[1].pending, true);
});
