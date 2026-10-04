import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

type Database = ReturnType<typeof drizzle>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// WebSocket connections must be closed within the serverless request that owns them.
export async function withTransaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    return await drizzle(pool).transaction(run);
  } finally {
    await pool.end();
  }
}
