import { getCurrentUserAccess } from '@/app/actions';

export async function requireGoogleStorageAdmin() {
  const access = await getCurrentUserAccess();
  if (!access.success || access.role !== 'admin') throw new Error('Administrator access is required.');
  return access;
}

export function requireStorageOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('Invalid request origin.');
}

export const storageResponseHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
