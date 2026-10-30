import { db } from '@/db';
import { auditLogs } from '@/db/schema';
import { authAuditEvent } from './auth-audit-event';

export async function writeAuthAudit(input: Parameters<typeof authAuditEvent>[0]) {
  try {
    await db.insert(auditLogs).values(authAuditEvent(input));
  } catch {
    // Authentication must still complete if audit storage is unavailable.
    // Never print request payloads, credentials, cookies, or provider errors.
    console.error('Authentication audit could not be persisted.');
  }
}
