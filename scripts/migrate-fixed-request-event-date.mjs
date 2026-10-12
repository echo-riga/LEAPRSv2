import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0019_fixed_request_event_date.sql', import.meta.url), 'utf8')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

await database.transaction(statements.map((statement) => database.query(statement)));
const [status] = await database.query(`
  SELECT
    (SELECT count(*)::int FROM request_field_definitions WHERE lower(btrim(name)) IN ('event date', 'event/activity date', 'activity date') AND is_active = true) AS active_dynamic_event_dates,
    (SELECT count(*)::int FROM requests WHERE event_date IS NOT NULL) AS requests_with_event_dates
`);
console.log(`Request Event Date migration complete: ${status.active_dynamic_event_dates} active dynamic Event Date fields; ${status.requests_with_event_dates} requests with fixed event dates.`);
