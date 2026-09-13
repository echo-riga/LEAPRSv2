CREATE TABLE IF NOT EXISTS "role_approval_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" varchar(255) NOT NULL,
  "email" varchar(255) NOT NULL,
  "department" varchar(255) NOT NULL,
  "requested_role" varchar(50) NOT NULL,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "decided_by_id" text,
  "decided_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_role_approval_user_idx" ON "role_approval_requests" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "role_approval_status_idx" ON "role_approval_requests" USING btree ("status");

DO $$ BEGIN
  ALTER TABLE "role_approval_requests" ADD CONSTRAINT "role_approval_requests_decided_by_id_users_id_fk"
    FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
