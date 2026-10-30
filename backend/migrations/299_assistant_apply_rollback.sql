-- An acknowledged rollback before any COMMIT attempt is positive evidence.
-- Legacy absence remains unknown. A fresh attempt clears this proof first.
ALTER TABLE ai_jobs ADD COLUMN apply_rolled_back_at timestamptz;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_apply_rollback_proof CHECK (
  apply_rolled_back_at IS NULL OR (
    apply_started_at IS NOT NULL AND apply_rolled_back_at>=apply_started_at
    AND apply_result IS NULL
  )
);
