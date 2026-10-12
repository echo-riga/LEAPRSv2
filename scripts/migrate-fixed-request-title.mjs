import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0018_fixed_request_title.sql', import.meta.url), 'utf8')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

await database.transaction(statements.map((statement) => database.query(statement)));
const [status] = await database.query(`
  SELECT
    (SELECT count(*)::int FROM request_field_definitions WHERE lower(btrim(name)) = 'title' AND is_active = true) AS active_dynamic_titles,
    (SELECT count(*)::int FROM requests WHERE btrim(description) <> '') AS requests_with_titles
`);
console.log(`Request Title migration complete: ${status.active_dynamic_titles} active dynamic Title fields; ${status.requests_with_titles} requests with fixed titles.`);
