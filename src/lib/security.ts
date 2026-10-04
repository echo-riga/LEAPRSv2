import { headers } from 'next/headers';
import { db } from '@/db';
import { hashVerificationCode } from '@/lib/verification-code';
import { rateLimitStatement } from '@/lib/security-rate-limit';
export { verificationCode } from '@/lib/verification-code';

export function verificationHash(purpose: string, email: string, code: string) {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret) throw new Error('Verification service is not configured.');
  return hashVerificationCode(purpose, email, code, secret);
}

// Shared PostgreSQL counters work across concurrent requests and server instances.
export async function consumeRateLimit(key: string, maximum: number, windowMs: number) {
  const result = await db.execute(rateLimitStatement(key, windowMs));
  return Number(result.rows[0].attempts) <= maximum;
}

export async function limitVerification(purpose: string, email: string, sending = false) {
  const requestHeaders = await headers();
  // The deployment proxy must overwrite forwarded IP headers.
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0].trim() || requestHeaders.get('x-real-ip') || 'unknown';
  if (!await consumeRateLimit(`${purpose}:ip:${ip}`, sending ? 20 : 30, 3600000)) return false;
  if (!await consumeRateLimit(`${purpose}:account:${email}`, sending ? 3 : 5, 900000)) return false;
  return !sending || await consumeRateLimit(`${purpose}:cooldown:${email}`, 1, 60000);
}
