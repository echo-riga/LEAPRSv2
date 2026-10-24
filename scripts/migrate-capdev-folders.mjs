import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0021_capdev_folders.sql', import.meta.url), 'utf8')
  .split(';').map(statement => statement.trim()).filter(Boolean);
await database.transaction(statements.map(statement => database.query(statement)));
console.log('CapDev folders migration applied; existing projects are preserved.');
