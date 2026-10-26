import { requireGoogleStorageAdmin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { getCurrentGoogleStorageOwner } from '@/lib/google-storage';
import { driveCleanupStatus } from '@/lib/drive-cleanup';

export const runtime = 'nodejs';
export async function GET() {
  try {
    await requireGoogleStorageAdmin();
    const owner = await getCurrentGoogleStorageOwner();
    return Response.json({ owner, cleanup: await driveCleanupStatus(), configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }, { headers: storageResponseHeaders });
  } catch { return Response.json({ error: 'Unable to load Google storage settings.' }, { status: 403, headers: storageResponseHeaders }); }
}
