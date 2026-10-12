WITH title_values AS (
  SELECT DISTINCT ON (request_record."id")
    request_record."id" AS "request_id",
    COALESCE(
      request_record."additional_info" ->> ('field:' || field_definition."id"::text),
      request_record."additional_info" ->> ('field-' || field_definition."id"::text),
      request_record."additional_info" ->> field_definition."name"
    ) AS "title"
  FROM "requests" AS request_record
  INNER JOIN "request_field_definitions" AS field_definition
    ON field_definition."setting" = request_record."setting"
   AND lower(btrim(field_definition."name")) = 'title'
  WHERE btrim(request_record."description") = ''
    AND btrim(COALESCE(
      request_record."additional_info" ->> ('field:' || field_definition."id"::text),
      request_record."additional_info" ->> ('field-' || field_definition."id"::text),
      request_record."additional_info" ->> field_definition."name",
      ''
    )) <> ''
  ORDER BY request_record."id", field_definition."is_active" DESC, field_definition."id" DESC
)
UPDATE "requests" AS request_record
SET "description" = title_values."title",
    "updated_at" = NOW()
FROM title_values
WHERE request_record."id" = title_values."request_id";

UPDATE "request_field_definitions"
SET "is_active" = false,
    "updated_at" = NOW()
WHERE lower(btrim("name")) = 'title'
  AND "is_active" = true;
