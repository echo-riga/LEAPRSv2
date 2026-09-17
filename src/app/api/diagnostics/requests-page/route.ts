import { performance } from 'node:perf_hooks';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { capdevs, requests, requestStatusUpdates } from '@/db/schema';
import { getSessionIdentity, getUserAccess } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const start = performance.now();
  const identity = await getSessionIdentity();
  const access = identity && await getUserAccess(identity.userId, identity.name, identity.email);
  if (access?.role !== 'admin') return Response.json({ error: 'Unauthorized' }, { status: 403 });
  const authMs = performance.now() - start;

  const aipCode = new URL(request.url).searchParams.get('aipCode')?.trim();
  if (!aipCode) return Response.json({ error: 'AIP code is required.' }, { status: 400 });

  try {
    let checkpoint = performance.now();
    const [capdev] = await db.select({ id: capdevs.id }).from(capdevs).where(eq(capdevs.aipCode, aipCode)).limit(1);
    const capdevMs = performance.now() - checkpoint;
    if (!capdev) return Response.json({ error: 'CapDev not found.' }, { status: 404 });

    checkpoint = performance.now();
    const requestRows = await db.select().from(requests).where(eq(requests.capdevId, capdev.id)).orderBy(requests.createdAt);
    const requestsMs = performance.now() - checkpoint;
    if (requestRows.length > 500) return Response.json({ error: 'Too many requests for this diagnostic.' }, { status: 413 });

    const ids = requestRows.map((row) => row.id);
    checkpoint = performance.now();
    const statusRows = ids.length
      ? await db.select().from(requestStatusUpdates).where(inArray(requestStatusUpdates.requestId, ids))
      : [];
    const statusBatchMs = performance.now() - checkpoint;

    checkpoint = performance.now();
    await Promise.all(ids.map((id) => db.select().from(requestStatusUpdates).where(eq(requestStatusUpdates.requestId, id)).orderBy(requestStatusUpdates.createdAt)));
    const statusFanoutMs = performance.now() - checkpoint;

    return Response.json({
      requestCount: ids.length,
      statusCount: statusRows.length,
      authMs: Math.round(authMs),
      capdevMs: Math.round(capdevMs),
      requestsMs: Math.round(requestsMs),
      statusBatchMs: Math.round(statusBatchMs),
      statusFanoutMs: Math.round(statusFanoutMs),
      totalMs: Math.round(performance.now() - start),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Request page diagnostic failed:', error);
    return Response.json({ error: 'Diagnostic failed.' }, { status: 500 });
  }
}
