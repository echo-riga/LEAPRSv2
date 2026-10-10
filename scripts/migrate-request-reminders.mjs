import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0015_request_inactivity_reminders.sql', import.meta.url), 'utf8')
  .split(';').map((statement) => statement.trim()).filter(Boolean);
await database.transaction(statements.map((statement) => database.query(statement)));
console.log('Request inactivity reminder schema is ready.');
