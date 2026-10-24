CREATE TABLE IF NOT EXISTS google_storage_connections (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  email text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  root_folder_id text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT false,
  is_legacy boolean NOT NULL DEFAULT false,
  connected_by_id text,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS google_storage_one_active_idx ON google_storage_connections (is_active) WHERE is_active = true;
CREATE TABLE IF NOT EXISTS google_drive_resources (
  file_id text PRIMARY KEY,
  root_folder_id text NOT NULL
);
DROP INDEX IF EXISTS request_storage_folders_request_idx;
CREATE UNIQUE INDEX IF NOT EXISTS request_storage_folders_request_root_idx ON request_storage_folders (request_id, root_folder_id);
