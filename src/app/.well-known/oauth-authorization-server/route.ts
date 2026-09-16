import { oauthConfig } from '@/lib/mcp/oauth';

export function GET() {
  const config = oauthConfig();
  if (!config) return Response.json({ error: 'MCP OAuth is not configured' }, { status: 503 });
  return Response.json({
    issuer: config.base,
    authorization_endpoint: `${config.base}/api/mcp/oauth/authorize`,
    token_endpoint: `${config.base}/api/mcp/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    scopes_supported: ['mcp'],
  });
}
