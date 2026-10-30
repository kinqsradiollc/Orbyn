-- Evidence only. No historical receipt absence is promoted to a known rollback.
ALTER TABLE ai_jobs ADD COLUMN apply_started_at timestamptz;
-- Only the canonical new admission writer opts in. Never stamp old jobs on resume.
-- Drain/fence old execution workers before enabling qualification for tracked jobs.
ALTER TABLE ai_jobs ADD COLUMN apply_tracking_version smallint CHECK (apply_tracking_version=1);
-- Existing apply writers persist apply_result atomically with their effects.
-- An old writer cannot commit such a write for a tracked job without the marker.
-- Legacy NULL jobs remain compatible and unqualified; this is not a guard for
-- arbitrary writers that do not follow that atomic apply_result contract.
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_tracked_apply_marker CHECK (
  apply_tracking_version IS NULL OR apply_result IS NULL OR apply_started_at IS NOT NULL
);
ALTER TABLE ai_jobs ADD COLUMN terminal_evidence jsonb;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_terminal_evidence_identity CHECK (
  terminal_evidence IS NULL OR coalesce(
    jsonb_typeof(terminal_evidence)='object'
    AND terminal_evidence->'version'='1'::jsonb
    AND terminal_evidence->>'job_id'=id::text,
    false
  )
);
