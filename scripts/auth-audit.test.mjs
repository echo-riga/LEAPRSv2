import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { authAuditEvent, authResponseIdentity } from '../src/lib/auth-audit-event.ts';
import { describeAudit } from '../src/lib/audit-description.ts';

function loadFunction(path, name, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  const code = ts.transpileModule(fn.getText(ast).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

const identity = { id: 'account-123', name: 'Test User', email: 'user@example.test' };
const headers = new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'user-agent': 'Test browser' });
function fixture({ response = Response.json({ user: identity }), session = identity, throws = false } = {}) {
  const entries = [];
  let calls = 0;
  const POST = loadFunction('../src/app/api/auth/[...path]/route.ts', 'POST', {
    handlers: { POST: async () => { calls++; if (throws) throw new Error('provider unavailable'); return response; } },
    auth: { getSession: async () => ({ data: { user: session } }) },
    isAllowedSignupEmail: email => typeof email === 'string' && email.endsWith('@example.test'),
    SIGNUP_EMAIL_ERROR: 'Domain not allowed', authResponseIdentity,
    writeAuthAudit: async input => entries.push(authAuditEvent(input)),
  });
  const send = (path, body = { email: identity.email, password: 'DO_NOT_LOG', code: '654321' }) => POST(new Request(`https://app.test/api/auth/${path}`, {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { send, entries, calls: () => calls, response };
}

test('login records provider identity, public IP, and no credentials; response stays readable', async () => {
  const f = fixture();
  const response = await f.send('sign-in/email');
  assert.equal(response, f.response);
  assert.deepEqual(await response.json(), { user: identity });
  const entry = f.entries[0];
  assert.equal(entry.action, 'login_succeeded');
  assert.equal(entry.actorId, identity.id);
  assert.equal(entry.actorName, identity.name);
  assert.equal(entry.actorEmail, identity.email);
  assert.equal(entry.details.ipAddress, '203.0.113.5');
  assert.doesNotMatch(JSON.stringify(entry), /DO_NOT_LOG|654321|password|cookie|token/);
});

test('failed login does not attribute an attempt to a returned or claimed identity', async () => {
  const f = fixture({ response: Response.json({ user: identity, message: 'secret provider body' }, { status: 401 }) });
  await f.send('sign-in/email');
  assert.equal(f.entries[0].action, 'login_failed');
  assert.equal(f.entries[0].actorId, null);
  assert.equal(f.entries[0].actorEmail, null);
  assert.equal(f.entries[0].details.email, identity.email);
  assert.equal(f.entries[0].details.identityVerified, false);
  assert.doesNotMatch(JSON.stringify(f.entries), /secret provider body/);
});

test('logout snapshots the session before sign-out; missing session remains unattributed', async () => {
  for (const session of [identity, null]) {
    const f = fixture({ response: Response.json({ success: true }), session });
    await f.send('sign-out');
    assert.equal(f.entries[0].action, 'logout_succeeded');
    assert.equal(f.entries[0].actorId, session?.id || null);
  }
});

test('sign-ups audit successes, domain rejections and malformed JSON', async () => {
  const f = fixture();
  await f.send('sign-up/email');
  assert.equal(f.entries[0].action, 'signup_succeeded');
  assert.equal((await f.send('sign-up/email', { email: 'bad@invalid.test' })).status, 400);
  assert.equal((await f.send('sign-up/email', '{')).status, 400);
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.entries.map(e => e.action), ['signup_succeeded', 'signup_failed', 'signup_failed']);
});

test('provider exceptions are audited once and unrelated auth requests are passed through', async () => {
  const f = fixture({ throws: true });
  await assert.rejects(f.send('sign-in/email'), /provider unavailable/);
  assert.equal(f.entries.length, 1);
  assert.equal(f.entries[0].details.httpStatus, 500);
  const other = fixture();
  await other.send('get-session');
  assert.equal(other.entries.length, 0);
});

test('IP validation handles IPv6, absent headers, and invalid first hop without trusting later hops', () => {
  for (const [values, expected] of [
    [{ 'x-forwarded-for': '2001:db8::5, 10.0.0.1' }, '2001:db8::5'],
    [{ 'x-real-ip': '203.0.113.8' }, '203.0.113.8'],
    [{}, null], [{ 'x-forwarded-for': 'spoofed, 203.0.113.8' }, null],
  ]) {
    assert.equal(authAuditEvent({ event: 'login', success: false, headers: new Headers(values) }).details.ipAddress, expected);
  }
});

test('verification wrappers preserve results and only resolve an account after a successful password reset', async () => {
  const entries = [];
  let lookups = 0;
  const audit = loadFunction('../src/app/actions.ts', 'auditVerification', {
    db: { execute: async () => { lookups++; return { rows: [identity] }; } }, sql: () => ({}),
    headers: async () => headers, writeAuthAudit: async input => entries.push(authAuditEvent(input)),
  });
  for (const event of ['signup_code_requested', 'signup_verification', 'password_reset_requested', 'password_reset']) {
    for (const success of [false, true]) {
      const result = { success };
      assert.equal(await audit(event, identity.email, async () => result), result);
      assert.equal(entries.at(-1).details.identityVerified, event === 'password_reset' && success);
      assert.equal(entries.at(-1).action, `${event}_${success ? 'succeeded' : 'failed'}`);
    }
  }
  assert.equal(lookups, 1);
});

test('audit persistence failure preserves authentication and emits no sensitive error payload', async () => {
  const errors = [];
  const write = loadFunction('../src/lib/auth-audit.ts', 'writeAuthAudit', {
    db: { insert: () => ({ values: async () => { throw new Error('sensitive database details'); } }) },
    auditLogs: {}, authAuditEvent, console: { error: text => errors.push(text) },
  });
  await write({ event: 'login', success: true, headers, identity });
  assert.equal(errors.length, 1);
  assert.doesNotMatch(errors[0], /sensitive database details/);
});

test('audit descriptions show identity, IP and request acceptance without claiming email delivery', () => {
  const entry = authAuditEvent({ event: 'login', success: true, identity, headers });
  const description = describeAudit(entry);
  assert.match(description.summary, /Login succeeded/);
  assert.ok(description.lines.includes('Public IP: 203.0.113.5'));
  assert.ok(description.lines.includes(`Account ID: ${identity.id}`));
  const requested = describeAudit(authAuditEvent({ event: 'password_reset_requested', success: true, headers, email: identity.email }));
  assert.match(requested.summary, /request accepted/);
  assert.ok(requested.lines.some(line => line.includes('does not confirm')));
});
