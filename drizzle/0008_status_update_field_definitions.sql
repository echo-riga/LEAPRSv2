CREATE TABLE IF NOT EXISTS "status_update_field_definitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "type" varchar(50) NOT NULL,
  "options" jsonb,
  "is_required" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "section" varchar(100) DEFAULT 'optional' NOT NULL,
  "width" varchar(50) DEFAULT 'full' NOT NULL,
  "column_position" varchar(10) DEFAULT 'left' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "placeholder" varchar(255),
  "updated_by_id" text NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "request_status_updates" ADD COLUMN IF NOT EXISTS "additional_info" jsonb DEFAULT '{}'::jsonb NOT NULL;
