import { isIP } from 'node:net';

export type AuthEvent = 'login' | 'logout' | 'signup' | 'signup_code_requested' | 'signup_verification' | 'password_reset_requested' | 'password_reset';
export type AuthIdentity = { id: string; name?: string | null; email: string };
type RequestHeaders = { get(name: string): string | null };

export function authAuditEvent(input: {
  event: AuthEvent; success: boolean; headers: RequestHeaders; email?: unknown;
  identity?: AuthIdentity | null; status?: number;
}) {
  // Only trust these headers behind a deployment proxy that overwrites them.
  const forwarded = input.headers.get('x-forwarded-for');
  const candidate = (forwarded?.split(',')[0] || input.headers.get('x-real-ip') || '').trim();
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 255) : null;
  const identity = input.success ? input.identity : null;
  return {
    actorId: identity?.id || null,
    actorName: identity ? (identity.name || identity.email).slice(0, 255) : 'Unverified visitor',
    actorEmail: identity?.email.slice(0, 255) || null,
    action: `${input.event}_${input.success ? 'succeeded' : 'failed'}`,
    entityType: 'authentication',
    entityId: identity?.id || null,
    entityLabel: (identity?.email || email || 'Unknown account').slice(0, 255),
    details: {
      event: input.event, outcome: input.success ? 'Succeeded' : 'Failed',
      identityVerified: Boolean(identity), accountId: identity?.id || null, email: identity?.email || email,
      ipAddress: isIP(candidate) ? candidate : null,
      userAgent: input.headers.get('user-agent')?.slice(0, 512) || null,
      ...(input.status === undefined ? {} : { httpStatus: input.status }),
    },
  };
}

export function authResponseIdentity(body: unknown): AuthIdentity | null {
  if (!body || typeof body !== 'object' || !('user' in body)) return null;
  const user = body.user;
  if (!user || typeof user !== 'object' || !('id' in user) || !('email' in user)) return null;
  if (typeof user.id !== 'string' || typeof user.email !== 'string') return null;
  return { id: user.id, email: user.email, name: 'name' in user && typeof user.name === 'string' ? user.name : null };
}
