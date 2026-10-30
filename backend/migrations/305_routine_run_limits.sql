-- Optional per-attempt bounds captured during explicit routine setup. Legacy
-- routines retain the runtime's current defaults; retry policy stays separate.
ALTER TABLE agent_routines ADD COLUMN run_limits jsonb;
ALTER TABLE agent_routines ADD CONSTRAINT agent_routines_run_limits_check CHECK (
  run_limits IS NULL OR coalesce(
    jsonb_typeof(run_limits)='object'
    AND (run_limits - 'token_limit' - 'active_work_minutes')='{}'::jsonb
    AND jsonb_typeof(run_limits->'token_limit')='number'
    AND (run_limits->>'token_limit')::numeric BETWEEN 1 AND 200000
    AND (run_limits->>'token_limit')::numeric=trunc((run_limits->>'token_limit')::numeric)
    AND jsonb_typeof(run_limits->'active_work_minutes')='number'
    AND (run_limits->>'active_work_minutes')::numeric BETWEEN 1 AND 10
    AND (run_limits->>'active_work_minutes')::numeric=trunc((run_limits->>'active_work_minutes')::numeric), false)
);
