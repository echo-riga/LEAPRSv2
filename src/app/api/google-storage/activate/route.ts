import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { withTransaction } from '@/db/transaction';
import { googleStorageConnections, auditLogs } from '@/db/schema';
import { requireGoogleStorageAdmin, requireStorageOrigin, storageResponseHeaders } from '@/lib/google-storage-admin';
import { getGoogleStorageToken } from '@/lib/google-storage';
import { inspectGoogleRoot } from '@/lib/google-storage-oauth';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    requireStorageOrigin(request);
    const admin = await requireGoogleStorageAdmin();
    const { id } = await request.json();
    if (typeof id !== 'string' || id.length > 100) throw new Error('Invalid connection.');
    const [connection] = await db.select().from(googleStorageConnections).where(eq(googleStorageConnections.id, id));
    if (!connection || !await inspectGoogleRoot(await getGoogleStorageToken(connection), connection.rootFolderId)) throw new Error('Reconnect this Google account before selecting it.');
    await withTransaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(724103, 2)`);
      await tx.update(googleStorageConnections).set({ isActive: false }).where(eq(googleStorageConnections.isActive, true));
      await tx.update(googleStorageConnections).set({ isActive: true }).where(eq(googleStorageConnections.id, id));
      await tx.insert(auditLogs).values({ actorId: admin.userId, actorName: admin.name || 'Administrator', actorEmail: admin.email,
        action: 'updated', entityType: 'system_setting', entityLabel: 'Google Drive storage', details: { email: connection.email, rootFolderId: connection.rootFolderId } });
    });
    return Response.json({ success: true }, { headers: storageResponseHeaders });
  } catch { return Response.json({ error: 'Unable to switch storage. Reconnect the account and try again.' }, { status: 400, headers: storageResponseHeaders }); }
}
