CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "actor_id" text,
  "actor_name" varchar(255) NOT NULL,
  "actor_email" varchar(255),
  "action" varchar(50) NOT NULL,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" text,
  "entity_label" varchar(255) NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type", "entity_id");

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "capdev_id" integer;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "request_id" integer;

UPDATE "notifications"
SET "request_id" = substring("link" from '/requests/([0-9]+)/status')::integer
WHERE "request_id" IS NULL AND "link" ~ '/requests/[0-9]+/status';

UPDATE "notifications"
SET "capdev_id" = substring("link" from '/capdev/([0-9]+)/requests')::integer
WHERE "capdev_id" IS NULL AND "link" ~ '/capdev/[0-9]+/requests';

DELETE FROM "notifications" n
WHERE (n."request_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "requests" r WHERE r."id" = n."request_id"))
   OR (n."capdev_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "capdevs" c WHERE c."id" = n."capdev_id"));

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_capdev_id_capdevs_id_fk"
    FOREIGN KEY ("capdev_id") REFERENCES "public"."capdevs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_request_id_requests_id_fk"
    FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
