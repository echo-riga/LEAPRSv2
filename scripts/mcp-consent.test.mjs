import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const nextServerUrl = pathToFileURL(require.resolve('next/server')).href;
const config = {
  base: 'https://leaprs.example.test', clientId: 'leaprs-claude',
  resource: 'https://leaprs.example.test/api/mcp',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
};
const grants = [];
function consentHash(nonce, input) {
  return createHash('sha256').update(JSON.stringify([nonce, input.clientId, input.redirectUri, input.challenge, input.resource, input.state])).digest('hex');
}
globalThis.mcpConsentTest = {
  oauthConfig: () => config,
  getOAuthClient: async id => id === config.clientId ? { clientName: 'Claude', redirectUris: config.redirectUris } : null,
  consentHash,
  getSessionIdentity: async () => ({ userId: 'test-user', name: 'Test User', email: 'test@example.test' }),
  getUserAccess: async () => ({ role: 'admin' }),
  randomToken: () => 'test-consent-nonce',
  secretMatches: (actual, expected) => actual === expected,
  issueGrant: async (...args) => { grants.push(args); return 'test-authorization-code'; },
};
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/mcp/oauth') return {
    url: 'data:text/javascript,' + encodeURIComponent('export const { oauthConfig, getOAuthClient, consentHash, getSessionIdentity, getUserAccess, randomToken, secretMatches, issueGrant } = globalThis.mcpConsentTest;'),
    shortCircuit: true,
  };
  return nextResolve(specifier === 'next/server' ? nextServerUrl : specifier, context);
} });
const { NextRequest } = await import('next/server');
const { GET, POST } = await import('../src/app/api/mcp/oauth/authorize/route.ts');

function authorizationUrl(overrides = {}) {
  const url = new URL('/api/mcp/oauth/authorize', config.base);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUris[0],
    response_type: 'code', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43),
    resource: config.resource, scope: 'mcp', state: 'client-state', ...overrides,
  }).toString();
  return url;
}
function consentPost(decision, csrf = 'test-consent-nonce', overrides = {}) {
  const cookie = consentHash('test-consent-nonce', {
    clientId: config.clientId, redirectUri: config.redirectUris[0], challenge: 'a'.repeat(43), resource: config.resource, state: 'client-state',
  });
  return new NextRequest(authorizationUrl(overrides), {
    method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Cookie: `leaprs_mcp_consent=${cookie}`,
    }, body: new URLSearchParams({ csrf, decision }),
  });
}

test('consent policy permits the validated external callback without wildcard destinations', async () => {
  const response = await GET(new NextRequest(authorizationUrl()));
  assert.equal(response.status, 200);
  const policy = response.headers.get('Content-Security-Policy');
  assert.match(policy, /form-action 'self' https:\/\/claude\.ai;/);
  assert.ok(!policy.includes('*'));
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(await response.text(), /name="csrf" value="test-consent-nonce"/);
});

test('allow issues a callback-bound code and redirects to Claude with original state', async () => {
  grants.length = 0;
  const response = await POST(consentPost('allow'));
  assert.equal(response.status, 303);
  const target = new URL(response.headers.get('Location'));
  assert.equal(target.origin + target.pathname, config.redirectUris[0]);
  assert.equal(target.searchParams.get('code'), 'test-authorization-code');
  assert.equal(target.searchParams.get('state'), 'client-state');
  assert.equal(target.searchParams.get('iss'), config.base);
  assert.equal(grants.length, 1);
  assert.equal(grants[0][5], config.redirectUris[0]);
  assert.equal(grants[0][6], 'a'.repeat(43));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Set-Cookie'), /Path=\/api\/mcp\/oauth\/authorize/);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('cancel returns access_denied without creating a grant', async () => {
  grants.length = 0;
  const response = await POST(consentPost('deny'));
  assert.equal(response.status, 303);
  const target = new URL(response.headers.get('Location'));
  assert.equal(target.searchParams.get('error'), 'access_denied');
  assert.equal(target.searchParams.get('state'), 'client-state');
  assert.equal(grants.length, 0);
});

test('unlisted callbacks and invalid consent cannot issue authorization codes', async () => {
  grants.length = 0;
  for (const redirect_uri of ['https://evil.example/callback', 'https://claude.ai/other-callback']) {
    assert.equal((await GET(new NextRequest(authorizationUrl({ redirect_uri })))).status, 400);
    assert.equal((await POST(consentPost('allow', 'test-consent-nonce', { redirect_uri }))).status, 400);
  }
  assert.equal((await POST(consentPost('allow', 'wrong-nonce'))).status, 403);
  assert.equal((await POST(consentPost('invalid'))).status, 400);
  assert.equal(grants.length, 0);
});

test('consent cannot be reused with modified OAuth state or PKCE challenge', async () => {
  grants.length = 0;
  assert.equal((await POST(consentPost('allow', 'test-consent-nonce', { state: 'changed-state' }))).status, 403);
  assert.equal((await POST(consentPost('allow', 'test-consent-nonce', { code_challenge: 'b'.repeat(43) }))).status, 403);
  assert.equal(grants.length, 0);
});
