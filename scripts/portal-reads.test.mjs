import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { withReadContext, readAccessOnce } from '../src/lib/read-context.ts';
import { readPortal } from '../src/lib/portal-read-client.ts';

test('access checks share one promise per read, with no cross-request or cross-account cache', async () => {
  let loads = 0;
  const load = async () => ({ user: ++loads });
  const [a, b] = await Promise.all([
    withReadContext(() => Promise.all([readAccessOnce(load), readAccessOnce(load)])),
    withReadContext(() => Promise.all([readAccessOnce(load), readAccessOnce(load)])),
  ]);
  assert.strictEqual(a[0], a[1]);
  assert.strictEqual(b[0], b[1]);
  assert.notStrictEqual(a[0], b[0]);
  assert.equal(loads, 2);
  await readAccessOnce(load);
  await readAccessOnce(load);
  assert.equal(loads, 4);
});

test('browser reads deduplicate only concurrent reads for the same account and retry failed reads', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let release;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'same-origin');
    await new Promise(resolve => { release = resolve; });
    return Response.json({ success: true });
  };
  try {
    const a = readPortal('notifications', {}, 'a');
    const b = readPortal('notifications', {}, 'a');
    assert.strictEqual(a, b);
    assert.equal(calls, 1);
    release();
    await a;
    const next = readPortal('notifications', {}, 'a');
    assert.equal(calls, 2);
    release();
    await next;
    const other = readPortal('notifications', {}, 'b');
    assert.equal(calls, 3);
    release();
    await other;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
    await assert.rejects(readPortal('notifications', {}, 'a'));
    await assert.rejects(readPortal('notifications', {}, 'a'));
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
});

const routeSource = readFileSync(new URL('../src/app/api/portal/read/route.ts', import.meta.url), 'utf8');
const routeAst = ts.createSourceFile('route.ts', routeSource, ts.ScriptTarget.Latest, true);
const postNode = routeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'POST');
const routeCode = ts.transpileModule(postNode.getText(routeAst).replace(/^export /, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

test('read endpoint rejects cross-origin, unknown operations, malformed filters, and invalid IDs without dispatch', async () => {
  let dispatches = 0;
  const portalReaders = { timeline: async () => { dispatches++; return { ok: true }; } };
  const POST = new Function('portalReaders', 'withReadContext', 'responseHeaders', routeCode + '; return POST;')(
    portalReaders, withReadContext, { 'Cache-Control': 'private, no-store' },
  );
  const request = (body, origin = 'https://app.test') => new Request('https://app.test/api/portal/read', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request({ kind: 'timeline', input: {} }, 'https://other.test'))).status, 403);
  for (const body of [{ kind: 'deleteCapdev', input: {} }, { kind: 'toString', input: {} },
    { kind: 'timeline', input: [] }, { kind: 'timeline', input: { requestId: -1 } }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(dispatches, 0);
  const response = await POST(request({ kind: 'timeline', input: { requestId: 1, capdevId: 2 } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(dispatches, 1);
});
