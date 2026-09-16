import { oauthConfig } from '@/lib/mcp/oauth';

export function GET() {
  const config = oauthConfig();
  if (!config) return Response.json({ error: 'MCP OAuth is not configured' }, { status: 503 });
  return Response.json({ resource: config.resource, authorization_servers: [config.base], scopes_supported: ['mcp'] });
}
