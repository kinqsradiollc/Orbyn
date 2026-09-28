-- A run's apply receipt commits with its changes. Unlike the general 24-hour
-- client_ref cache, this survives a long service outage until the job is swept.
ALTER TABLE ai_jobs ADD COLUMN apply_result jsonb;
