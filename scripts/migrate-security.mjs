import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
if (process.argv.includes('--apply')) {
  const statements = readFileSync(new URL('../drizzle/0011_security_and_query_indexes.sql', import.meta.url), 'utf8')
    .split(';').map((statement) => statement.trim()).filter((statement) => statement && statement !== 'BEGIN' && statement !== 'COMMIT');
  await database.transaction(statements.map((statement) => database.query(statement)));
  console.log('Applied additive security migration. Existing records were preserved.');
}
const rows = await database.query(`SELECT table_name, column_name, data_type, character_maximum_length
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('security_rate_limits', 'request_storage_folders', 'password_resets', 'signup_verifications')
  ORDER BY table_name, ordinal_position`);
console.log(JSON.stringify(rows));
