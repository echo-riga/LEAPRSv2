import { getCapdevFolderReferenceImage } from '@/app/actions';
import { getGoogleDriveAccessToken } from '@/lib/google-drive-auth';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params;
  const result = await getCapdevFolderReferenceImage(Number(folderId));
  const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
  if (!result.success) return new Response('Access denied.', { status: 403, headers });
  if (!result.image || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(result.image.mimeType)) return new Response('No reference file.', { status: 404, headers });
  try {
    const token = await getGoogleDriveAccessToken();
    const response = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(result.image.id) + '?alt=media', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (!response.ok) return new Response('Reference file is unavailable.', { status: response.status === 404 ? 404 : 502, headers });
    return new Response(response.body, { headers: { ...headers, 'Content-Type': result.image.mimeType, 'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(result.image.name) } });
  } catch { return new Response('Reference file is unavailable.', { status: 502, headers }); }
}
