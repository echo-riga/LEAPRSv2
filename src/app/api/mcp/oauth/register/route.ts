import { NextRequest } from 'next/server';
import { oauthConfig, registerClient } from '@/lib/mcp/oauth';
import { validateClientRegistration } from '@/lib/mcp/client-registration';
import { consumeRateLimit } from '@/lib/security';

export const runtime = 'nodejs';
const MAX_BODY_BYTES = 16384;

function error(code: string, description: string, status = 400) {
  return Response.json({ error: code, error_description: description }, {
    status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '3600' } : {}) },
  });
}

export async function POST(req: NextRequest) {
  if (!oauthConfig()) return error('server_error', 'MCP OAuth is not configured.', 503);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return error('invalid_client_metadata', 'Expected application/json.', 415);
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim().slice(0, 100) || 'unknown';
    if (!await consumeRateLimit(`mcp:registration:ip:${ip}`, 20, 3600000) ||
        !await consumeRateLimit('mcp:registration:global', 500, 3600000)) {
      return error('temporarily_unavailable', 'Too many client registrations. Try again later.', 429);
    }
    const reader = req.body?.getReader();
    if (!reader) return error('invalid_client_metadata', 'Missing metadata.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return error('invalid_client_metadata', 'Client metadata is too large.', 413);
      }
      chunks.push(value);
    }
    let metadata: unknown;
    try {
      metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      validateClientRegistration(metadata);
    } catch (problem) {
      return error('invalid_client_metadata', problem instanceof SyntaxError ? 'Invalid JSON.' :
        problem instanceof Error ? problem.message : 'Invalid metadata.');
    }
    return Response.json(await registerClient(metadata), { status: 201, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch {
    console.error('MCP automatic client registration failed.');
    return error('server_error', 'Client registration is temporarily unavailable.', 503);
  }
}
