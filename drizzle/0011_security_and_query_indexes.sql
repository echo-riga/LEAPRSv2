BEGIN;
ALTER TABLE password_resets ALTER COLUMN code TYPE varchar(64);
ALTER TABLE signup_verifications ALTER COLUMN code TYPE varchar(64);
CREATE TABLE IF NOT EXISTS security_rate_limits (
  key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamp NOT NULL
);
CREATE TABLE IF NOT EXISTS request_storage_folders (
  folder_id text PRIMARY KEY,
  request_id integer REFERENCES requests(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_folder_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS security_rate_limits_expires_idx ON security_rate_limits(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS request_storage_folders_request_idx ON request_storage_folders(request_id);
CREATE INDEX IF NOT EXISTS capdevs_department_created_idx ON capdevs(department, created_at, id);
CREATE INDEX IF NOT EXISTS capdevs_created_idx ON capdevs(created_at, id);
CREATE INDEX IF NOT EXISTS requests_capdev_created_idx ON requests(capdev_id, created_at, id);
CREATE INDEX IF NOT EXISTS requests_user_created_idx ON requests(user_id, created_at, id);
CREATE INDEX IF NOT EXISTS request_status_updates_request_created_idx ON request_status_updates(request_id, created_at);
CREATE INDEX IF NOT EXISTS password_resets_email_idx ON password_resets(email);
COMMIT;
