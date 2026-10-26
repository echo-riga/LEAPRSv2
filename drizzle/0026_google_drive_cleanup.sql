CREATE TABLE IF NOT EXISTS google_drive_cleanup_jobs (
  file_id text PRIMARY KEY,
  root_folder_id text NOT NULL,
  kind text NOT NULL DEFAULT 'file',
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  page_token text,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS google_drive_cleanup_due_idx ON google_drive_cleanup_jobs(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS google_drive_cleanup_scans (
  root_folder_id text PRIMARY KEY,
  page_token text,
  updated_at timestamp NOT NULL DEFAULT now()
);
