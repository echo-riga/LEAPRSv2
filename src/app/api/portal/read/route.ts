import { portalReaders } from '@/lib/portal-reads';
import { withReadContext } from '@/lib/read-context';

export const runtime = 'nodejs';
const responseHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers: responseHeaders });
  }
  try {
    const body = await request.text();
    if (body.length > 16384) throw new Error('Invalid request.');
    const { kind, input } = JSON.parse(body);
    if (typeof kind !== 'string' || !Object.hasOwn(portalReaders, kind) || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid request.');
    for (const key of ['capdevId', 'requestId', 'folderId']) {
      if (kind === 'capdev' && key === 'folderId' && input[key] === 0) continue;
      if (key in input && (!Number.isSafeInteger(input[key]) || input[key] <= 0)) throw new Error('Invalid ID.');
    }
    const reader = portalReaders[kind as keyof typeof portalReaders] as (input: never) => Promise<unknown>;
    const data = await withReadContext(() => reader(input as never));
    return Response.json(data, { headers: responseHeaders });
  } catch {
    return Response.json({ error: 'Unable to load page data.' }, { status: 400, headers: responseHeaders });
  }
}
