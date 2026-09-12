ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "participant_feedback_form_id" text;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "participant_feedback_form_url" text;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "supervisor_evaluation_form_id" text;
ALTER TABLE "requests" ADD COLUMN IF NOT EXISTS "supervisor_evaluation_form_url" text;
