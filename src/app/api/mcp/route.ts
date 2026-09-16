import { NextRequest } from 'next/server';
import { LEAPRS_MCP_TOOLS, executeMcpTool } from '@/lib/mcp/server';
import { getBearerAccess, getSessionIdentity, getUserAccess, MCP_PROTOCOL_VERSION, oauthConfig } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

function challenge() {
  const config = oauthConfig();
  const metadata = config ? `${config.base}/.well-known/oauth-protected-resource/api/mcp` : '';
  return Response.json({ error: 'Unauthorized' }, {
    status: 401,
    headers: { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}", scope="mcp"`, 'Cache-Control': 'no-store' },
  });
}

function validOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const config = oauthConfig();
  return origin === (config?.base || req.nextUrl.origin);
}

async function requestAccess(req: NextRequest) {
  if (req.headers.has('authorization')) return getBearerAccess(req.headers.get('authorization'));
  const session = await getSessionIdentity();
  return session ? getUserAccess(session.userId, session.name, session.email) : null;
}

function rpc(id: string | number | null, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id, result }, { headers: { 'Cache-Control': 'no-store' } });
}

function rpcError(id: string | number | null, code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: NextRequest) {
  if (!validOrigin(req)) return new Response(null, { status: 403 });
  if (!await requestAccess(req)) return challenge();
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!validOrigin(req)) return new Response(null, { status: 403 });
  const access = await requestAccess(req);
  if (!access) return challenge();
  if (!req.headers.get('content-type')?.startsWith('application/json')) return rpcError(null, -32600, 'Expected application/json', 415);

  let body: unknown;
  try { body = await req.json(); }
  catch { return rpcError(null, -32700, 'Parse error', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return rpcError(null, -32600, 'Invalid request', 400);
  const message = body as Record<string, unknown>;
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(null, -32600, 'Invalid JSON-RPC request', 400);
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
    ? message.params as Record<string, unknown> : {};

  if (id === null) return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });

  try {
    switch (message.method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        const protocolVersion = requested === '2025-03-26' || requested === '2025-06-18' || requested === MCP_PROTOCOL_VERSION
          ? requested : MCP_PROTOCOL_VERSION;
        return rpc(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'leaprs', version: '1.0.0' },
          instructions: 'Use LEAPRS tools with the connected user’s current role and department permissions. Submit a request only after the user explicitly confirms its details.',
        });
      }
      case 'ping': return rpc(id, {});
      case 'tools/list': return rpc(id, { tools: LEAPRS_MCP_TOOLS.map((tool) => ({
        ...tool,
        title: tool.name.replaceAll('_', ' '),
        annotations: { readOnlyHint: tool.name !== 'submit_request', destructiveHint: false },
      })) });
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string' || !LEAPRS_MCP_TOOLS.some((tool) => tool.name === name)) return rpcError(id, -32602, 'Unknown or missing tool name');
        const args = params.arguments;
        if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) return rpcError(id, -32602, 'Tool arguments must be an object');
        const result = await executeMcpTool(access, name, (args || {}) as Record<string, unknown>);
        return rpc(id, {
          content: [{ type: 'text', text: result.success ? JSON.stringify(result.data ?? null) : result.error || 'Tool execution failed' }],
          isError: !result.success,
        });
      }
      default: return rpcError(id, -32601, `Method not found: ${message.method}`);
    }
  } catch (error) {
    console.error('MCP request failed:', error);
    return rpcError(id, -32603, 'Internal MCP error');
  }
}
