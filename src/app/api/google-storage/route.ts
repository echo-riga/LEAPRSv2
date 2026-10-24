import { requireGoogleStorageAdmin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { getCurrentGoogleStorageOwner } from '@/lib/google-storage';

export const runtime = 'nodejs';
export async function GET() {
  try {
    await requireGoogleStorageAdmin();
    const owner = await getCurrentGoogleStorageOwner();
    return Response.json({ owner, configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }, { headers: storageResponseHeaders });
  } catch { return Response.json({ error: 'Unable to load Google storage settings.' }, { status: 403, headers: storageResponseHeaders }); }
}
