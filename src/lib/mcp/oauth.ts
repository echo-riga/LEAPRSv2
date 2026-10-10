import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { mcpOAuthClients, mcpOAuthGrants, systemSettings, users } from '@/db/schema';
import { validateClientRegistration } from '@/lib/mcp/client-registration';
import { auth } from '@/lib/auth/server';
import type { AppRole, UserAccess } from '@/lib/services/leaprs-service';

const VALID_ROLES: AppRole[] = ['admin', 'employee', 'employee-department', 'viewer', 'viewer-full'];
export const MCP_PROTOCOL_VERSION = '2025-11-25';

export function oauthConfig() {
  const base = process.env.MCP_PUBLIC_URL?.replace(/\/$/, '');
  if (!base) return null;
  let url: URL;
  try { url = new URL(base); }
  catch { return null; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  return { base, resource: `${base}/api/mcp` };
}

export async function registerClient(input: unknown) {
  const metadata = validateClientRegistration(input);
  const clientId = randomToken();
  const clientSecret = metadata.tokenEndpointAuthMethod === 'none' ? undefined : randomToken();
  await db.insert(mcpOAuthClients).values({
    clientId, ...metadata, clientSecretHash: clientSecret ? tokenHash(clientSecret) : null,
  });
  return {
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_name: metadata.clientName, redirect_uris: metadata.redirectUris,
    token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'mcp',
  };
}

export async function getOAuthClient(clientId: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(clientId)) return null;
  const [client] = await db.select().from(mcpOAuthClients).where(eq(mcpOAuthClients.clientId, clientId)).limit(1);
  return client || null;
}

export function consentHash(nonce: string, input: {
  clientId: string; redirectUri: string; challenge: string; resource: string; state: string | null;
}) {
  return tokenHash(JSON.stringify([nonce, input.clientId, input.redirectUri, input.challenge, input.resource, input.state]));
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
  const [storedUser] = await db.select({ role: users.role, department: users.department }).from(users).where(and(eq(users.id, userId), isNull(users.archivedAt))).limit(1);
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
    eq(mcpOAuthGrants.resource, config.resource),
    gt(mcpOAuthGrants.expiresAt, new Date()),
  )).limit(1);
  if (!grant || !await getOAuthClient(grant.clientId)) return null;
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
