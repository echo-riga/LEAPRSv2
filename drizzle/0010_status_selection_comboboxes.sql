-- Replace the active text Action/Office fields while preserving their option
-- order, layout, and historical timeline values. Old fields use the same soft
-- deletion as the configuration UI. Safe to reapply after a successful run.
WITH previous AS MATERIALIZED (
  SELECT * FROM status_update_field_definitions
  WHERE is_active = true AND type IN ('text', 'textarea')
    AND lower(trim(name)) IN ('action', 'office')
), replacements AS (
  INSERT INTO status_update_field_definitions (
    name, type, options, is_required, is_active, section, width,
    column_position, sort_order, placeholder, updated_by_id
  )
  SELECT name, 'combobox', options, is_required, true, section, width,
    column_position, sort_order, 'Select an option...', updated_by_id
  FROM previous
  RETURNING id, name, updated_by_id
), mapping AS MATERIALIZED (
  SELECT previous.id AS old_id, replacements.id AS new_id,
    previous.name, replacements.updated_by_id
  FROM previous JOIN replacements ON replacements.name = previous.name
), migrated_values AS (
  UPDATE request_status_updates AS timeline
  SET additional_info = timeline.additional_info || (
    SELECT jsonb_object_agg('field:' || mapping.new_id,
      CASE WHEN timeline.additional_info ? ('field:' || mapping.old_id)
        THEN timeline.additional_info -> ('field:' || mapping.old_id)
        ELSE timeline.additional_info -> mapping.name END)
    FROM mapping
    WHERE timeline.additional_info ? ('field:' || mapping.old_id)
      OR timeline.additional_info ? mapping.name
  )
  WHERE EXISTS (
    SELECT 1 FROM mapping
    WHERE timeline.additional_info ? ('field:' || mapping.old_id)
      OR timeline.additional_info ? mapping.name
  )
  RETURNING timeline.id
), retired_fields AS (
  UPDATE status_update_field_definitions
  SET is_active = false, updated_at = now()
  WHERE id IN (SELECT old_id FROM mapping)
  RETURNING id
), audit_entries AS (
  INSERT INTO audit_logs (actor_name, action, entity_type, entity_id, entity_label, details)
  SELECT 'Configuration migration', 'updated', 'status_update_field',
    new_id::text, name,
    jsonb_build_object('previousFieldId', old_id, 'type', 'combobox',
      'migration', '0010_status_selection_comboboxes')
  FROM mapping
  RETURNING id
)
SELECT mapping.old_id, mapping.new_id, mapping.name,
  (SELECT count(*) FROM migrated_values) AS migrated_timeline_rows,
  (SELECT count(*) FROM retired_fields) AS retired_fields,
  (SELECT count(*) FROM audit_entries) AS audit_entries
FROM mapping;
