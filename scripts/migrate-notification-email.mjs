import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0016_notification_email.sql', import.meta.url), 'utf8')
  .replace(/--[^\n]*/g, '').split(';').map(statement => statement.trim()).filter(Boolean);
await database.transaction(statements.map(statement => database.query(statement)));
console.log('Notification email schema is ready. Existing records preserved; historical events will not be emailed.');
