import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0020_repeatable_capdev_aip_codes.sql', import.meta.url), 'utf8')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

await database.transaction(statements.map((statement) => database.query(statement)));
const [status] = await database.query(`
  SELECT
    NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_schema = 'public' AND table_name = 'capdevs'
        AND constraint_name = 'capdevs_aip_code_unique'
    ) AS uniqueness_removed,
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'capdevs'
        AND indexname = 'capdevs_aip_code_idx'
    ) AS lookup_index_present
`);
if (!status.uniqueness_removed || !status.lookup_index_present) throw new Error('Repeatable CapDev AIP migration is incomplete.');
console.log('CapDev AIP Codes can repeat; the non-unique lookup index is present.');
