ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS number_value integer;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reminder_key varchar(100);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_reminder_key_idx ON notifications (reminder_key);
