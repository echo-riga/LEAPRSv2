'use server';

import { getSessionIdentity, getUserAccess, oauthConfig, revokeClientGrants } from '@/lib/mcp/oauth';
import { db } from '@/db';
import { mcpOAuthClients, mcpOAuthGrants } from '@/db/schema';
import { and, eq, gt, sql } from 'drizzle-orm';

async function currentIdentity() {
  const identity = await getSessionIdentity();
  if (!identity || !await getUserAccess(identity.userId, identity.name, identity.email)) throw new Error('Sign in to an active LEAPRS account.');
  return identity;
}

export async function getConnectedAiApps() {
  try {
    const identity = await currentIdentity();
    const apps = await db.select({ clientId: mcpOAuthClients.clientId, name: mcpOAuthClients.clientName,
      callbacks: mcpOAuthClients.redirectUris, approvedAt: sql<string>`min(${mcpOAuthGrants.createdAt})` })
      .from(mcpOAuthClients).innerJoin(mcpOAuthGrants, eq(mcpOAuthClients.clientId, mcpOAuthGrants.clientId))
      .where(and(eq(mcpOAuthGrants.userId, identity.userId), gt(mcpOAuthGrants.expiresAt, new Date())))
      .groupBy(mcpOAuthClients.clientId).orderBy(mcpOAuthClients.clientName);
    return { success: true as const, apps: apps.map(app => ({ clientId: app.clientId, name: app.name,
      origins: [...new Set(app.callbacks.map(callback => new URL(callback).origin))] })) };
  } catch { return { success: false as const, error: 'Unable to load connected apps.' }; }
}

export async function revokeAiApp(clientId: string) {
  try {
    const identity = await currentIdentity();
    if (!/^[A-Za-z0-9_-]{43}$/.test(clientId)) throw new Error('Invalid app.');
    await revokeClientGrants(identity.userId, clientId);
    return { success: true as const };
  } catch { return { success: false as const, error: 'Unable to revoke app access.' }; }
}

export async function getMcpConnectionInfo() {
  try {
    const identity = await getSessionIdentity();
    if (!identity || !await getUserAccess(identity.userId, identity.name, identity.email)) {
      return { success: false as const, error: 'Sign in to an active LEAPRS account to view connection details.' };
    }
    const config = oauthConfig();
    if (!config) return { success: false as const, error: 'AI app connections are not configured yet.' };
    return { success: true as const, serverUrl: config.resource };
  } catch {
    return { success: false as const, error: 'Unable to load connection details. Try again.' };
  }
}
