import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { googleStorageConnections, auditLogs } from '@/db/schema';
import { withTransaction } from '@/db/transaction';
import { requireGoogleStorageAdmin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { GOOGLE_OAUTH_COOKIE, verifyGoogleStorageFlow, findOrCreateGoogleRoot, inspectGoogleRoot } from '@/lib/google-storage-oauth';
import { driveFetch, googleTokenRequest, GOOGLE_STORAGE_SCOPES } from '@/lib/google-storage';
import { encryptGoogleSecret } from '@/lib/google-storage-crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const jar = await cookies();
  const cookie = jar.get(GOOGLE_OAUTH_COOKIE)?.value;
  jar.set(GOOGLE_OAUTH_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/google-storage', maxAge: 0 });
  const url = new URL(request.url);
  let result = 'connection_failed';
  try {
    const admin = await requireGoogleStorageAdmin();
    const flow = verifyGoogleStorageFlow(cookie || '', url.searchParams.get('state') || '', admin.userId);
    if (url.searchParams.has('error')) {
      result = 'cancelled';
    } else {
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new Error('Missing authorization code.');
      const tokens = await googleTokenRequest({ code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier, grant_type: 'authorization_code' });
      const granted = new Set(tokens.scope?.split(' ') || []);
      if (!GOOGLE_STORAGE_SCOPES.every(scope => granted.has(scope))) throw new Error('Grant all required Drive and Forms permissions.');
      const response = await driveFetch('/about?fields=user(permissionId,emailAddress)', tokens.access_token!);
      if (!response.ok) throw new Error('Unable to identify the connected account.');
      const { user } = await response.json() as { user?: { permissionId?: string; emailAddress?: string } };
      if (!user?.permissionId || !user.emailAddress) throw new Error('Google did not identify the storage account.');
      await withTransaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(724103, 2)`);
        const all = await tx.select().from(googleStorageConnections).for('update');
        const existing = all.find(connection => connection.accountId === user.permissionId && !connection.isLegacy);
        const refresh = tokens.refresh_token;
        if (!refresh && !existing) throw new Error('Reconnect and grant offline access.');
        const encrypted = refresh ? encryptGoogleSecret(refresh) : existing!.encryptedRefreshToken;
        const root = await findOrCreateGoogleRoot(tokens.access_token!, existing?.rootFolderId);
        const sameRoot = all.find(connection => connection.rootFolderId === root);
        // A new connection must not claim a root already registered to another account.
        if (sameRoot && !sameRoot.isLegacy && sameRoot.accountId !== user.permissionId) throw new Error('Storage account mismatch.');
        // Keep old storage roots usable after reconnecting the same Google account.
        for (const previous of all) {
          if (previous.accountId === user.permissionId || (previous.isLegacy && await inspectGoogleRoot(tokens.access_token!, previous.rootFolderId))) {
            await tx.update(googleStorageConnections).set({ accountId: user.permissionId, email: user.emailAddress!, encryptedRefreshToken: encrypted, updatedAt: new Date() }).where(eq(googleStorageConnections.id, previous.id));
          }
        }
        await tx.update(googleStorageConnections).set({ isActive: false }).where(eq(googleStorageConnections.isActive, true));
        const values = { accountId: user.permissionId!, email: user.emailAddress!, encryptedRefreshToken: encrypted,
          rootFolderId: root, isActive: true, connectedById: admin.userId, updatedAt: new Date() };
        if (sameRoot) await tx.update(googleStorageConnections).set(values).where(eq(googleStorageConnections.id, sameRoot.id));
        else await tx.insert(googleStorageConnections).values({ id: randomUUID(), ...values });
        await tx.insert(auditLogs).values({ actorId: admin.userId, actorName: admin.name || 'Administrator', actorEmail: admin.email,
          action: 'updated', entityType: 'system_setting', entityLabel: 'Google Drive storage', details: { email: user.emailAddress, rootFolderId: root } });
      });
      result = 'connected';
    }
  } catch { /* Never put provider responses, codes, or tokens in logs or URLs. */ }
  return NextResponse.redirect(new URL('/portal/settings?storage=' + result, request.url), { status: 303, headers: storageResponseHeaders });
}
