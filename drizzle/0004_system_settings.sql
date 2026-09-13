CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" varchar(100) PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_by_id" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "system_settings" DROP CONSTRAINT IF EXISTS "system_settings_updated_by_id_users_id_fk";

DO $$ BEGIN
  ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_users_id_fk"
    FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "system_settings" ("key", "enabled")
VALUES ('maintenance_mode', false)
ON CONFLICT ("key") DO NOTHING;
