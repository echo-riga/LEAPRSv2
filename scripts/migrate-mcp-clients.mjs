import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0017_mcp_oauth_clients.sql', import.meta.url), 'utf8')
  .split(';').map(statement => statement.trim()).filter(Boolean);
await database.transaction(statements.map(statement => database.query(statement)));
console.log('Automatic MCP client registration schema is ready. Existing data preserved.');
