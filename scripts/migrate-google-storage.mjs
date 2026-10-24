import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { encryptGoogleSecret } from '../src/lib/google-storage-crypto.ts';

process.loadEnvFile('.env.local');
const database = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL('../drizzle/0024_google_storage_connections.sql', import.meta.url), 'utf8').split(';').map(value => value.trim()).filter(Boolean);
await database.transaction(statements.map(statement => database.query(statement)));
// Preserve the former storage credentials before an Admin switches accounts.
const root = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
const token = process.env.GOOGLE_REFRESH_TOKEN?.trim();
if (root && token) {
  await database.query(`INSERT INTO google_storage_connections
    (id,account_id,email,encrypted_refresh_token,root_folder_id,is_active,is_legacy)
    SELECT $1,$2,'Previous storage account',$3,$4,NOT EXISTS(SELECT 1 FROM google_storage_connections WHERE is_active),true
    WHERE NOT EXISTS(SELECT 1 FROM google_storage_connections WHERE root_folder_id=$4)
    ON CONFLICT(root_folder_id) DO NOTHING`, [randomUUID(), 'legacy:' + root, encryptGoogleSecret(token), root]);
}
console.log('Google storage migration applied; existing storage retained.');
