import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
await database.query(readFileSync(new URL('../drizzle/0023_capdev_folder_reference_image.sql', import.meta.url), 'utf8'));
console.log('CapDev folder reference image migration applied.');
