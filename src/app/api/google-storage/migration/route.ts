import { requireGoogleStorageAdmin, requireStorageOrigin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { advanceStorageMigration, getStorageMigrationStatus } from '@/lib/google-storage-migration';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET() {
  try {
    await requireGoogleStorageAdmin();
    return Response.json({ migration: await getStorageMigrationStatus() }, { headers: storageResponseHeaders });
  } catch {
    return Response.json({ error: 'Unable to load the file transfer.' }, { status: 403, headers: storageResponseHeaders });
  }
}

export async function POST(request: Request) {
  try {
    requireStorageOrigin(request);
    await requireGoogleStorageAdmin();
    const body = await request.json();
    if (typeof body.retry !== 'boolean') throw new Error('Invalid transfer request.');
    return Response.json({ migration: await advanceStorageMigration(body.retry) }, { headers: storageResponseHeaders });
  } catch {
    return Response.json({ error: 'Unable to advance the file transfer. Please retry.' }, { status: 400, headers: storageResponseHeaders });
  }
}
