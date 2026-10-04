import { sql } from 'drizzle-orm';

export function rateLimitStatement(key: string, windowMs: number) {
  return sql`
    INSERT INTO security_rate_limits (key, attempts, expires_at)
    VALUES (${key}, 1, NOW() + ${windowMs} * INTERVAL '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN security_rate_limits.expires_at <= NOW() THEN 1 ELSE security_rate_limits.attempts + 1 END,
      expires_at = CASE WHEN security_rate_limits.expires_at <= NOW() THEN EXCLUDED.expires_at ELSE security_rate_limits.expires_at END
    RETURNING attempts
  `;
}
