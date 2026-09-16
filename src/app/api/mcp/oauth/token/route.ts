import { NextRequest } from 'next/server';
import { consumeGrant, getUserAccess, issueGrant, oauthConfig, pkceChallenge, secretMatches } from '@/lib/mcp/oauth';

function error(code: string, status = 400) {
  return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const config = oauthConfig();
  if (!config) return error('server_error', 503);
  if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return error('invalid_request');
  const form = await req.formData();
  let clientId = String(form.get('client_id') || '');
  let clientSecret = String(form.get('client_secret') || '');
  const authorization = req.headers.get('authorization');
  if (authorization?.startsWith('Basic ')) {
    try {
      const pair = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = pair.indexOf(':');
      if (separator < 0) return error('invalid_client', 401);
      clientId = decodeURIComponent(pair.slice(0, separator));
      clientSecret = decodeURIComponent(pair.slice(separator + 1));
    } catch { return error('invalid_client', 401); }
  }
  if (clientId !== config.clientId || !secretMatches(clientSecret, config.clientSecret)) return error('invalid_client', 401);
  const grantType = form.get('grant_type');
  const resource = String(form.get('resource') || config.resource);
  if (resource !== config.resource) return error('invalid_target');

  let grant;
  if (grantType === 'authorization_code') {
    const code = form.get('code');
    const verifier = form.get('code_verifier');
    const redirectUri = form.get('redirect_uri');
    if (typeof code !== 'string' || typeof verifier !== 'string' || typeof redirectUri !== 'string' ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return error('invalid_request');
    grant = await consumeGrant(code, 'code', clientId);
    if (!grant || grant.redirectUri !== redirectUri || !grant.codeChallenge ||
        !secretMatches(pkceChallenge(verifier), grant.codeChallenge)) return error('invalid_grant');
  } else if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token');
    if (typeof refreshToken !== 'string') return error('invalid_request');
    grant = await consumeGrant(refreshToken, 'refresh', clientId);
    if (!grant) return error('invalid_grant');
  } else return error('unsupported_grant_type');

  if (grant.resource !== resource) return error('invalid_target');
  const identity = { userId: grant.userId, name: grant.userName, email: grant.userEmail };
  if (!await getUserAccess(identity.userId, identity.name, identity.email)) return error('invalid_grant');
  const accessToken = await issueGrant('access', identity, clientId, resource, 60 * 60_000);
  const refreshToken = await issueGrant('refresh', identity, clientId, resource, 30 * 24 * 60 * 60_000);
  return Response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: 'mcp' }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
}
