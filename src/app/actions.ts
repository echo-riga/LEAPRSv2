'use server';

import { db } from '@/db';
import { connections } from '@/db/schema';
import { sql, count } from 'drizzle-orm';

export interface DbStatus {
  success: boolean;
  latencyMs?: number;
  testedAt?: string;
  writeSuccess?: boolean;
  totalChecks?: number;
  errorMessage?: string;
}

export async function checkDrizzleConnection(): Promise<DbStatus> {
  const testedAt = new Date().toISOString();
  const start = Date.now();
  
  try {
    // 1. Test Read Connection
    await db.execute(sql`SELECT NOW()`);
    const latencyMs = Date.now() - start;

    // 2. Test Write Connection (Log check to Neon via Drizzle)
    let writeSuccess = false;
    try {
      await db.insert(connections).values({
        status: 'success',
      });
      writeSuccess = true;
    } catch (e: any) {
      console.error('Database write error:', e);
    }

    // 3. Count Checks (Test aggregation/read query)
    let totalChecks = 0;
    try {
      const countRes = await db.select({ value: count() }).from(connections);
      totalChecks = countRes[0].value || 0;
    } catch (e: any) {
      console.error('Database aggregation error:', e);
    }

    return {
      success: true,
      latencyMs,
      testedAt,
      writeSuccess,
      totalChecks,
    };
  } catch (error: any) {
    console.error('Database connection check failed:', error);
    return {
      success: false,
      testedAt,
      errorMessage: error.message || 'Unknown database connection error',
    };
  }
}
