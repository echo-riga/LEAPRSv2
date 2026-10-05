ALTER TABLE capdevs ADD COLUMN IF NOT EXISTS archived_at timestamp;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS archived_at timestamp;
ALTER TABLE request_status_updates ADD COLUMN IF NOT EXISTS archived_at timestamp;
CREATE INDEX IF NOT EXISTS capdevs_archived_at_idx ON capdevs (archived_at);
CREATE INDEX IF NOT EXISTS requests_archived_at_idx ON requests (archived_at);
CREATE INDEX IF NOT EXISTS request_status_updates_archived_at_idx ON request_status_updates (archived_at);
