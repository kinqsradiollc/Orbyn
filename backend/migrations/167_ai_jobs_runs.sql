-- Persist assistant run progress and enough state to resume a paused lead.
-- Safe to run again.

ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS progress jsonb;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS run_state jsonb;

ALTER TABLE ai_jobs DROP CONSTRAINT IF EXISTS ai_jobs_state_check;
ALTER TABLE ai_jobs
  ADD CONSTRAINT ai_jobs_state_check
  CHECK (state IN ('running', 'waiting', 'done', 'failed'));
