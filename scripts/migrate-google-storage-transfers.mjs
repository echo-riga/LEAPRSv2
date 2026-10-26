import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0025_google_storage_migrations.sql', import.meta.url), 'utf8')
  .split(';').map(value => value.trim()).filter(Boolean);
await database.transaction(statements.map(statement => database.query(statement)));
console.log('Google storage transfer tables applied. No Drive files were changed.');
