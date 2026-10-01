ALTER TABLE "request_field_definitions"
  ADD COLUMN IF NOT EXISTS "setting" varchar(50) NOT NULL DEFAULT 'internal';

CREATE INDEX IF NOT EXISTS "request_field_definitions_setting_idx"
  ON "request_field_definitions" ("setting", "is_active", "sort_order");

-- Preserve the existing request form as the initial configuration for both
-- settings. External requests receive values under the copied field IDs so
-- their historical dynamic data continues to render after the split.
DO $$
DECLARE
  source_field RECORD;
  copied_field_id integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "request_field_definitions" WHERE "setting" = 'external'
  ) THEN
    FOR source_field IN
      SELECT *
      FROM "request_field_definitions"
      WHERE "setting" = 'internal'
      ORDER BY "id"
    LOOP
      INSERT INTO "request_field_definitions" (
        "setting", "name", "type", "options", "is_required", "is_active",
        "section", "width", "column_position", "sort_order", "placeholder",
        "updated_by_id", "created_at", "updated_at"
      ) VALUES (
        'external', source_field."name", source_field."type", source_field."options",
        source_field."is_required", source_field."is_active", source_field."section",
        source_field."width", source_field."column_position", source_field."sort_order",
        source_field."placeholder", source_field."updated_by_id",
        source_field."created_at", source_field."updated_at"
      ) RETURNING "id" INTO copied_field_id;

      UPDATE "requests"
      SET "additional_info" =
        CASE
          WHEN "additional_info" ? ('field:' || source_field."id"::text)
          THEN jsonb_set(
            "additional_info",
            ARRAY['field:' || copied_field_id::text],
            "additional_info" -> ('field:' || source_field."id"::text),
            true
          )
          ELSE "additional_info"
        END
      WHERE "setting" = 'external';

      UPDATE "requests"
      SET "additional_info" =
        CASE
          WHEN "additional_info" ? ('field-' || source_field."id"::text)
          THEN jsonb_set(
            "additional_info",
            ARRAY['field-' || copied_field_id::text],
            "additional_info" -> ('field-' || source_field."id"::text),
            true
          )
          ELSE "additional_info"
        END
      WHERE "setting" = 'external';
    END LOOP;
  END IF;
END $$;
