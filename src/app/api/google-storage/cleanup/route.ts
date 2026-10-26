import { timingSafeEqual } from 'node:crypto';
import { requireGoogleStorageAdmin, requireStorageOrigin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { discoverUnreferencedDriveUploads, driveCleanupStatus, processDriveCleanup, retryFailedDriveCleanup } from '@/lib/drive-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get('authorization') || '';
  const expected = `Bearer ${secret}`;
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: storageResponseHeaders });
  }
  try {
    const scan = await discoverUnreferencedDriveUploads();
    const result = await processDriveCleanup(100, 200000);
    return Response.json({ ...result, scan, jobs: await driveCleanupStatus() }, { headers: storageResponseHeaders });
  } catch {
    return Response.json({ error: 'Cleanup remains queued for retry.' }, { status: 503, headers: storageResponseHeaders });
  }
}

export async function POST(request: Request) {
  try {
    requireStorageOrigin(request);
    await requireGoogleStorageAdmin();
    await retryFailedDriveCleanup();
    return Response.json({ ...await processDriveCleanup(10), jobs: await driveCleanupStatus() }, { headers: storageResponseHeaders });
  } catch {
    return Response.json({ error: 'Unable to process storage cleanup.' }, { status: 400, headers: storageResponseHeaders });
  }
}
