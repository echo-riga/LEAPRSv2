BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at timestamp;
CREATE INDEX IF NOT EXISTS users_archived_at_idx ON users(archived_at);
COMMIT;
