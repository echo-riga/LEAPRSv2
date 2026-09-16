import { NextRequest, NextResponse } from 'next/server';
import { getSessionIdentity, getUserAccess, issueGrant, oauthConfig, randomToken, secretMatches } from '@/lib/mcp/oauth';

const COOKIE_NAME = 'leaprs_mcp_consent';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}

function authorizeParams(params: URLSearchParams) {
  const config = oauthConfig();
  if (!config) return null;
  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const challenge = params.get('code_challenge') || '';
  const resource = params.get('resource') || config.resource;
  const scope = params.get('scope') || 'mcp';
  if (clientId !== config.clientId || !config.redirectUris.includes(redirectUri) ||
      params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || resource !== config.resource || scope !== 'mcp') return null;
  return { config, clientId, redirectUri, challenge, resource, state: params.get('state') };
}

function callback(uri: string, state: string | null, issuer: string, key: string, value: string) {
  const url = new URL(uri);
  url.searchParams.set(key, value);
  url.searchParams.set('iss', issuer);
  if (state !== null) url.searchParams.set('state', state);
  return url;
}

export async function GET(req: NextRequest) {
  const input = authorizeParams(req.nextUrl.searchParams);
  if (!input) return new Response('Invalid OAuth authorization request or server configuration.', { status: 400 });
  const identity = await getSessionIdentity();
  if (!identity) {
    const login = new URL('/', input.config.base);
    login.searchParams.set('next', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  if (!await getUserAccess(identity.userId, identity.name, identity.email)) {
    return new Response('Your LEAPRS account is unavailable or maintenance mode is active.', { status: 403 });
  }
  const nonce = randomToken();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Claude to LEAPRS</title><style>body{font:16px system-ui;background:#f6f7f9;color:#17212d;display:grid;place-items:center;min-height:100vh;margin:0}main{background:white;border:1px solid #dce2e8;border-radius:12px;max-width:480px;padding:32px;box-shadow:0 12px 32px #17212d12}h1{font-size:24px;margin-top:0}p{line-height:1.5}button{border:0;border-radius:7px;padding:12px 18px;font:inherit;cursor:pointer}button[name=decision][value=allow]{background:#17487a;color:white}button[name=decision][value=deny]{background:#e9edf1;margin-left:8px}</style></head><body><main><h1>Connect Claude to LEAPRS?</h1><p>Signed in as ${escapeHtml(identity.email || identity.name)}.</p><p>Claude will be able to use your LEAPRS tools with your current role and department permissions, including submitting requests if your role permits it. Only approve if you started this connection in Claude.</p><form method="post"><input type="hidden" name="csrf" value="${nonce}"><button name="decision" value="allow">Allow access</button><button name="decision" value="deny">Cancel</button></form></main></body></html>`;
  const response = new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
  response.cookies.set(COOKIE_NAME, nonce, { httpOnly: true, secure: input.config.base.startsWith('https:'), sameSite: 'lax', path: '/api/mcp/oauth/authorize', maxAge: 600 });
  return response;
}

export async function POST(req: NextRequest) {
  const input = authorizeParams(req.nextUrl.searchParams);
  if (!input) return new Response('Invalid OAuth authorization request.', { status: 400 });
  const form = await req.formData();
  const csrf = form.get('csrf');
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (typeof csrf !== 'string' || !cookie || !secretMatches(csrf, cookie)) return new Response('Invalid consent request.', { status: 403 });
  const identity = await getSessionIdentity();
  if (!identity || !await getUserAccess(identity.userId, identity.name, identity.email)) return new Response('LEAPRS session expired.', { status: 401 });
  const decision = form.get('decision');
  if (decision !== 'allow' && decision !== 'deny') return new Response('Invalid decision.', { status: 400 });
  const target = decision === 'allow'
    ? callback(input.redirectUri, input.state, input.config.base, 'code', await issueGrant('code', identity, input.clientId, input.resource, 5 * 60_000, input.redirectUri, input.challenge))
    : callback(input.redirectUri, input.state, input.config.base, 'error', 'access_denied');
  const response = NextResponse.redirect(target, { status: 303 });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
