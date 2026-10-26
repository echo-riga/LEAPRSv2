CREATE TABLE IF NOT EXISTS google_storage_migrations (
  id text PRIMARY KEY,
  source_root text NOT NULL,
  target_root text NOT NULL,
  source_connection_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  phase text NOT NULL DEFAULT 'discovering',
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_storage_migrations_status_idx ON google_storage_migrations(status);
CREATE UNIQUE INDEX IF NOT EXISTS google_storage_migrations_source_idx ON google_storage_migrations(source_root);
CREATE TABLE IF NOT EXISTS google_storage_migration_items (
  id serial PRIMARY KEY,
  migration_id text NOT NULL REFERENCES google_storage_migrations(id) ON DELETE CASCADE,
  file_id text NOT NULL,
  name text NOT NULL,
  mime_type text NOT NULL,
  depth integer NOT NULL,
  scanned boolean NOT NULL DEFAULT false,
  page_token text,
  done boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS google_storage_migration_file_idx ON google_storage_migration_items(migration_id, file_id);
CREATE INDEX IF NOT EXISTS google_storage_migration_pending_idx ON google_storage_migration_items(migration_id, done, scanned);
