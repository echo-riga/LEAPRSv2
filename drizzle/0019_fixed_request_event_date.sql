ALTER TABLE "requests"
  ADD COLUMN IF NOT EXISTS "event_date" date;

WITH event_date_values AS (
  SELECT DISTINCT ON (request_record."id")
    request_record."id" AS "request_id",
    COALESCE(
      request_record."additional_info" ->> ('field:' || field_definition."id"::text),
      request_record."additional_info" ->> ('field-' || field_definition."id"::text),
      request_record."additional_info" ->> field_definition."name"
    ) AS "event_date"
  FROM "requests" AS request_record
  INNER JOIN "request_field_definitions" AS field_definition
    ON field_definition."setting" = request_record."setting"
   AND lower(btrim(field_definition."name")) IN ('event date', 'event/activity date', 'activity date')
  WHERE request_record."event_date" IS NULL
    AND COALESCE(
      request_record."additional_info" ->> ('field:' || field_definition."id"::text),
      request_record."additional_info" ->> ('field-' || field_definition."id"::text),
      request_record."additional_info" ->> field_definition."name",
      ''
    ) ~ '^\d{4}-\d{2}-\d{2}$'
  ORDER BY request_record."id", field_definition."is_active" DESC, field_definition."id" DESC
)
UPDATE "requests" AS request_record
SET "event_date" = event_date_values."event_date"::date,
    "updated_at" = NOW()
FROM event_date_values
WHERE request_record."id" = event_date_values."request_id";

UPDATE "request_field_definitions"
SET "is_active" = false,
    "updated_at" = NOW()
WHERE lower(btrim("name")) IN ('event date', 'event/activity date', 'activity date')
  AND "is_active" = true;
