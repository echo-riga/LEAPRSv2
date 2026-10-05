import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0014_permanent_budget_deductions.sql', import.meta.url), 'utf8')
  .split(';').map((statement) => statement.trim()).filter(Boolean);
await database.transaction(statements.map((statement) => database.query(statement)));
const columns = await database.query(`SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'budget_deducted_at'`);
if (columns.length !== 1) throw new Error('Permanent deduction migration is incomplete.');
console.log('Verified permanent deduction marker and backfilled existing deductions.');
