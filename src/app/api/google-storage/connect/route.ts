import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireGoogleStorageAdmin, requireStorageOrigin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { createGoogleStorageFlow, googleStorageCallbackUri, GOOGLE_OAUTH_COOKIE } from '@/lib/google-storage-oauth';
import { googleOAuthCredentials, GOOGLE_STORAGE_SCOPES } from '@/lib/google-storage';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireStorageOrigin(request);
    const admin = await requireGoogleStorageAdmin();
    const { clientId } = googleOAuthCredentials();
    const { flow, cookie, challenge } = createGoogleStorageFlow(admin.userId, googleStorageCallbackUri());
    (await cookies()).set(GOOGLE_OAUTH_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/google-storage', maxAge: 600 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: flow.redirectUri, response_type: 'code',
      scope: GOOGLE_STORAGE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account',
      state: flow.state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return NextResponse.redirect(url, { status: 303, headers: storageResponseHeaders });
  } catch {
    return NextResponse.redirect(new URL('/portal/settings?storage=configuration_error', request.url), { status: 303, headers: storageResponseHeaders });
  }
}
