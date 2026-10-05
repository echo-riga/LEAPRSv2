import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0013_resource_archiving.sql', import.meta.url), 'utf8')
  .split(';').map((statement) => statement.trim()).filter(Boolean);
await database.transaction(statements.map((statement) => database.query(statement)));
const columns = await database.query(`SELECT table_name FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'archived_at'
  AND table_name IN ('capdevs', 'requests', 'request_status_updates') ORDER BY table_name`);
if (columns.length !== 3) throw new Error('Resource archive migration is incomplete.');
console.log('Verified archive columns for CapDev, requests, and progress updates.');
