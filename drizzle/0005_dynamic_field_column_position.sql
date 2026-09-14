ALTER TABLE "capdev_field_definitions"
ADD COLUMN IF NOT EXISTS "column_position" varchar(10) DEFAULT 'left' NOT NULL;

ALTER TABLE "request_field_definitions"
ADD COLUMN IF NOT EXISTS "column_position" varchar(10) DEFAULT 'left' NOT NULL;
