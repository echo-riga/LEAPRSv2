-- Existing events remain in-app only; do not email historical notifications.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE notifications ALTER COLUMN email_eligible SET DEFAULT true;

CREATE TABLE IF NOT EXISTS email_notification_preferences (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled_types jsonb NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_email_deliveries (
  id serial PRIMARY KEY,
  notification_id integer NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claim_token text,
  claimed_at timestamp,
  first_attempt_at timestamp,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_email_pending_idx ON notification_email_deliveries(status, next_attempt_at);
