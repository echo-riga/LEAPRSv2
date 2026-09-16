import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import { mcpOAuthGrants, systemSettings, users } from '@/db/schema';
import { auth } from '@/lib/auth/server';
import type { AppRole, UserAccess } from '@/lib/services/leaprs-service';

const VALID_ROLES: AppRole[] = ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full'];
export const MCP_PROTOCOL_VERSION = '2025-11-25';

export function oauthConfig() {
  const base = process.env.MCP_PUBLIC_URL?.replace(/\/$/, '');
  const clientId = process.env.MCP_OAUTH_CLIENT_ID;
  const clientSecret = process.env.MCP_OAUTH_CLIENT_SECRET;
  const redirectUris = (process.env.MCP_OAUTH_REDIRECT_URIS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!base || !clientId || !clientSecret || !redirectUris.length) return null;
  let url: URL;
  try { url = new URL(base); }
  catch { return null; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  return { base, clientId, clientSecret, redirectUris, resource: `${base}/api/mcp` };
}

export function secretMatches(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function randomToken() { return randomBytes(32).toString('base64url'); }
export function tokenHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function pkceChallenge(value: string) { return createHash('sha256').update(value).digest('base64url'); }

export async function getSessionIdentity() {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return {
    userId: session.user.id,
    name: session.user.name || session.user.email || 'LEAPRS User',
    email: session.user.email || null,
  };
}

export async function getUserAccess(userId: string, name: string, email: string | null): Promise<UserAccess | null> {
  const [storedUser] = await db.select({ role: users.role, department: users.department }).from(users).where(eq(users.id, userId)).limit(1);
  if (!storedUser || !VALID_ROLES.includes(storedUser.role as AppRole)) return null;
  const role = storedUser.role as AppRole;
  if (role !== 'admin') {
    const [maintenance] = await db.select({ enabled: systemSettings.enabled }).from(systemSettings).where(eq(systemSettings.key, 'maintenance_mode')).limit(1);
    if (maintenance?.enabled) return null;
  }
  return { userId, role, department: storedUser.department, name, email: email || undefined };
}

export async function getBearerAccess(authorization: string | null): Promise<UserAccess | null> {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization || '');
  const config = oauthConfig();
  if (!match || !config) return null;
  const [grant] = await db.select().from(mcpOAuthGrants).where(and(
    eq(mcpOAuthGrants.tokenHash, tokenHash(match[1])),
    eq(mcpOAuthGrants.kind, 'access'),
    eq(mcpOAuthGrants.clientId, config.clientId),
    eq(mcpOAuthGrants.resource, config.resource),
    gt(mcpOAuthGrants.expiresAt, new Date()),
  )).limit(1);
  if (!grant) return null;
  return getUserAccess(grant.userId, grant.userName, grant.userEmail);
}

export async function issueGrant(kind: 'code' | 'access' | 'refresh', identity: {
  userId: string; name: string; email: string | null;
}, clientId: string, resource: string, lifetimeMs: number, redirectUri?: string, codeChallenge?: string) {
  const token = randomToken();
  await db.insert(mcpOAuthGrants).values({
    tokenHash: tokenHash(token), kind, userId: identity.userId,
    userName: identity.name, userEmail: identity.email, clientId, resource,
    redirectUri, codeChallenge, expiresAt: new Date(Date.now() + lifetimeMs),
  });
  return token;
}

export async function consumeGrant(token: string, kind: 'code' | 'refresh', clientId: string) {
  const [grant] = await db.delete(mcpOAuthGrants).where(and(
    eq(mcpOAuthGrants.tokenHash, tokenHash(token)),
    eq(mcpOAuthGrants.kind, kind),
    eq(mcpOAuthGrants.clientId, clientId),
    gt(mcpOAuthGrants.expiresAt, new Date()),
  )).returning();
  return grant || null;
}
