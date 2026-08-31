ALTER TABLE "capdevs" ADD COLUMN IF NOT EXISTS "initial_budget" numeric(12, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "capdevs" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "description" text DEFAULT '' NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "department" varchar(255) DEFAULT 'Unassigned' NOT NULL;

UPDATE "capdevs" AS capdev
SET "initial_budget" = capdev."budget" + COALESCE((
  SELECT SUM(request."requested_budget")
  FROM "request_status_updates" AS status_update
  INNER JOIN "requests" AS request ON request.id = status_update.request_id
  WHERE request.capdev_id = capdev.id
    AND status_update.subtracts_requested_amount = true
), 0)
WHERE capdev."initial_budget" = 0;

ALTER TABLE "capdevs" DROP COLUMN IF EXISTS "start_date";
ALTER TABLE "capdevs" DROP COLUMN IF EXISTS "end_date";
ALTER TABLE "requests" DROP COLUMN IF EXISTS "start_date";
ALTER TABLE "requests" DROP COLUMN IF EXISTS "end_date";
