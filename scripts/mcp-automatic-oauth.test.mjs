import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';

process.loadEnvFile('.env.local');
process.env.MCP_PUBLIC_URL = 'https://leaprs.example.test';
const context = new AsyncLocalStorage();
globalThis.automaticMcpDb = new Proxy({}, { get(_, key) {
  const db = context.getStore();
  return typeof db[key] === 'function' ? db[key].bind(db) : db[key];
} });
const identity = { id: randomUUID(), name: 'Test User', email: 'oauth@example.test' };
globalThis.automaticMcpAuth = { getSession: async () => ({ data: { user: identity } }) };
const require = createRequire(import.meta.url);
const nextServerUrl = pathToFileURL(require.resolve('next/server')).href;
const nextHeadersUrl = pathToFileURL(require.resolve('next/headers')).href;
const virtual = text => ({ url: 'data:text/javascript,' + encodeURIComponent(text), shortCircuit: true });
registerHooks({ resolve(specifier, ctx, nextResolve) {
  if (specifier === '@/db') return virtual('export const db = globalThis.automaticMcpDb;');
  if (specifier === '@/lib/auth/server') return virtual('export const auth = globalThis.automaticMcpAuth;');
  return nextResolve(specifier === 'next/server' ? nextServerUrl : specifier === 'next/headers' ? nextHeadersUrl : specifier.startsWith('@/') ?
    new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href : specifier, ctx);
} });
const { NextRequest } = await import('next/server');
const { POST: register } = await import('../src/app/api/mcp/oauth/register/route.ts');
const { GET: consent, POST: approve } = await import('../src/app/api/mcp/oauth/authorize/route.ts');
const { POST: exchange } = await import('../src/app/api/mcp/oauth/token/route.ts');
const { GET: discovery } = await import('../src/app/.well-known/oauth-authorization-server/route.ts');
const { getBearerAccess, oauthConfig } = await import('../src/lib/mcp/oauth.ts');
const { validateClientRegistration } = await import('../src/lib/mcp/client-registration.ts');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const name = 'mcp_test_' + randomUUID().replaceAll('-', '');
const quoted = '"' + name + '"';
const base = process.env.MCP_PUBLIC_URL;

function request(path, body, headers = {}) {
  return new NextRequest(base + path, { method: 'POST', headers, body });
}
function registration(metadata) {
  return register(request('/api/mcp/oauth/register', JSON.stringify(metadata), { 'Content-Type': 'application/json', 'X-Forwarded-For': 'test-ip' }));
}
function token(body, headers = {}) {
  return exchange(request('/api/mcp/oauth/token', new URLSearchParams(body), { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }));
}
async function authorize(client, redirectUri) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL('/api/mcp/oauth/authorize', base);
  url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code', scope: 'mcp',
    resource: base + '/api/mcp', state: 'test-state' }).toString();
  const screen = await consent(new NextRequest(url));
  assert.equal(screen.status, 200);
  const html = await screen.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  const cookie = screen.headers.get('Set-Cookie').split(';')[0];
  const response = await approve(new NextRequest(url, { method: 'POST', headers: {
    'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie,
  }, body: new URLSearchParams({ csrf, decision: 'allow' }) }));
  assert.equal(response.status, 303);
  const callback = new URL(response.headers.get('Location'));
  assert.equal(callback.searchParams.get('state'), 'test-state');
  assert.equal(callback.searchParams.get('iss'), base);
  return { code: callback.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri };
}

test('automatic OAuth registration, consent, tokens and live user permissions', async t => {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA ' + quoted);
    for (const table of ['users', 'system_settings', 'security_rate_limits', 'mcp_oauth_clients', 'mcp_oauth_grants']) {
      await client.query(`CREATE TABLE ${quoted}."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    }
    await client.query('SET search_path TO ' + quoted);
    await context.run(drizzle(client), async () => {
      const db = context.getStore();
      await db.execute(sql`INSERT INTO users(id,role,department) VALUES (${identity.id},'employee','Alpha')`);
      let publicClient, confidentialClient, credentials;
      await t.test('discovery and configuration work without manual client credentials', async () => {
        delete process.env.MCP_OAUTH_CLIENT_ID;
        delete process.env.MCP_OAUTH_CLIENT_SECRET;
        delete process.env.MCP_OAUTH_REDIRECT_URIS;
        assert.ok(oauthConfig());
        const metadata = await discovery().json();
        assert.equal(metadata.registration_endpoint, base + '/api/mcp/oauth/register');
        assert.ok(metadata.token_endpoint_auth_methods_supported.includes('none'));
        assert.equal(metadata.authorization_response_iss_parameter_supported, true);
      });
      await t.test('separate connectors register public and confidential clients automatically', async () => {
        const first = await registration({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector/oauth/test'], token_endpoint_auth_method: 'none' });
        assert.equal(first.status, 201);
        publicClient = await first.json();
        assert.equal(publicClient.client_secret, undefined);
        const second = await registration({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_basic' });
        assert.equal(second.status, 201);
        confidentialClient = await second.json();
        assert.notEqual(publicClient.client_id, confidentialClient.client_id);
        const stored = await db.execute(sql`SELECT client_secret_hash FROM mcp_oauth_clients WHERE client_id = ${confidentialClient.client_id}`);
        assert.equal(stored.rows[0].client_secret_hash, createHash('sha256').update(confidentialClient.client_secret).digest('hex'));
        assert.notEqual(stored.rows[0].client_secret_hash, confidentialClient.client_secret);
      });
      await t.test('public client signs in and receives user-bound tokens with PKCE', async () => {
        const grant = await authorize(publicClient, publicClient.redirect_uris[0]);
        const body = { ...grant, client_id: publicClient.client_id, grant_type: 'authorization_code', resource: base + '/api/mcp' };
        const response = await token(body);
        assert.equal(response.status, 200);
        credentials = await response.json();
        const access = await getBearerAccess('Bearer ' + credentials.access_token);
        assert.equal(access.userId, identity.id);
        assert.equal(access.role, 'employee');
        assert.equal(access.department, 'Alpha');
        assert.equal((await token(body)).status, 400);
      });
      await t.test('refresh rotates tokens and cannot be used by another connector', async () => {
        const basic = Buffer.from(confidentialClient.client_id + ':' + confidentialClient.client_secret).toString('base64');
        assert.equal((await token({ client_id: confidentialClient.client_id,
          grant_type: 'refresh_token', refresh_token: credentials.refresh_token }, { Authorization: 'Basic ' + basic })).status, 400);
        const oldRefresh = credentials.refresh_token;
        const response = await token({ client_id: publicClient.client_id, grant_type: 'refresh_token', refresh_token: oldRefresh });
        assert.equal(response.status, 200);
        credentials = await response.json();
        assert.notEqual(credentials.refresh_token, oldRefresh);
        assert.equal((await token({ client_id: publicClient.client_id, grant_type: 'refresh_token', refresh_token: oldRefresh })).status, 400);
      });
      await t.test('confidential clients require their own secret and registered authentication method', async () => {
        const grant = await authorize(confidentialClient, confidentialClient.redirect_uris[0]);
        const body = { ...grant, client_id: confidentialClient.client_id, grant_type: 'authorization_code' };
        const basic = Buffer.from(confidentialClient.client_id + ':' + confidentialClient.client_secret).toString('base64');
        assert.equal((await token(body)).status, 401);
        const response = await token(body, { Authorization: 'Basic ' + basic });
        assert.equal(response.status, 200);
        assert.equal((await getBearerAccess('Bearer ' + (await response.json()).access_token)).userId, identity.id);
      });
      await t.test('wrong PKCE, callbacks, resource and legacy static credentials are rejected', async () => {
        const grant = await authorize(publicClient, publicClient.redirect_uris[0]);
        assert.equal((await token({ ...grant, client_id: publicClient.client_id, grant_type: 'authorization_code', resource: 'https://evil.example/mcp' })).status, 400);
        assert.equal((await token({ ...grant, client_id: publicClient.client_id, grant_type: 'authorization_code', code_verifier: 'b'.repeat(43) })).status, 400);
        const otherGrant = await authorize(publicClient, publicClient.redirect_uris[0]);
        assert.equal((await token({ ...otherGrant, client_id: publicClient.client_id, grant_type: 'authorization_code', redirect_uri: 'https://evil.example/callback' })).status, 400);
        assert.equal((await token({ client_id: 'leaprs-claude', client_secret: 'old-secret', grant_type: 'refresh_token', refresh_token: 'old-token' })).status, 401);
      });
      await t.test('archiving, current role, maintenance and client deletion affect token access immediately', async () => {
        await db.execute(sql`UPDATE users SET role = 'viewer', department = 'Beta' WHERE id = ${identity.id}`);
        assert.equal((await getBearerAccess('Bearer ' + credentials.access_token)).department, 'Beta');
        await db.execute(sql`UPDATE users SET archived_at = NOW() WHERE id = ${identity.id}`);
        assert.equal(await getBearerAccess('Bearer ' + credentials.access_token), null);
        await db.execute(sql`UPDATE users SET archived_at = NULL WHERE id = ${identity.id}`);
        await db.execute(sql`INSERT INTO system_settings(key,enabled) VALUES ('maintenance_mode',true)`);
        assert.equal(await getBearerAccess('Bearer ' + credentials.access_token), null);
        await db.execute(sql`UPDATE system_settings SET enabled = false`);
        await db.execute(sql`DELETE FROM mcp_oauth_clients WHERE client_id = ${publicClient.client_id}`);
        assert.equal(await getBearerAccess('Bearer ' + credentials.access_token), null);
      });
      await t.test('invalid metadata, oversized input and registration abuse are rejected', async () => {
        assert.equal((await registration({ redirect_uris: ['javascript:alert(1)'] })).status, 400);
        assert.equal((await registration({ redirect_uris: ['https://example.test/callback'], client_name: 'a'.repeat(17000) })).status, 413);
        await db.execute(sql`UPDATE security_rate_limits SET attempts = 20 WHERE key = 'mcp:registration:ip:test-ip'`);
        assert.equal((await registration({ redirect_uris: ['https://example.test/callback'] })).status, 429);
      });
    });
  } finally {
    await client.query('SET search_path TO public');
    await client.query('DROP SCHEMA IF EXISTS ' + quoted + ' CASCADE');
    client.release();
    await pool.end();
  }
});

test('callback metadata validation rejects insecure or ambiguous destinations', () => {
  for (const redirect of ['http://example.test/callback', 'https://user:pass@example.test/callback', 'https://example.test/callback#fragment', 'https://*.example.test/callback', '//example.test/callback', 'https://example.test/call back']) {
    assert.throws(() => validateClientRegistration({ redirect_uris: [redirect] }));
  }
  assert.throws(() => validateClientRegistration({ redirect_uris: ['https://example.test/callback'], token_endpoint_auth_method: 'unsupported' }));
  assert.deepEqual(validateClientRegistration({ redirect_uris: ['http://127.0.0.1:3456/oauth/callback'], token_endpoint_auth_method: 'none' }).redirectUris,
    ['http://127.0.0.1:3456/oauth/callback']);
});
