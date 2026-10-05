ALTER TABLE requests ADD COLUMN IF NOT EXISTS budget_deducted_at timestamp;
UPDATE requests AS request
SET budget_deducted_at = deduction.created_at
FROM (
  SELECT request_id, MIN(created_at) AS created_at
  FROM request_status_updates WHERE subtracts_requested_amount = true GROUP BY request_id
) AS deduction
WHERE request.id = deduction.request_id AND request.budget_deducted_at IS NULL;
