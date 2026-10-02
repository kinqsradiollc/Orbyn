-- Persist ownership independently of checkpoints, which are cleared at completion.
CREATE FUNCTION assistant_runtime_lane(checkpoint jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN checkpoint->'request'->'automation'->>'kind' = 'night'
      OR nullif(checkpoint->'request'->'automation'->>'night_id', '') IS NOT NULL
      THEN 'overnight'
    WHEN nullif(checkpoint->'request'->'automation', 'null'::jsonb) IS NOT NULL
      THEN 'background'
    ELSE 'interactive'
  END
$$;

ALTER TABLE ai_jobs ADD COLUMN runtime_lane text;
UPDATE ai_jobs j SET runtime_lane = CASE
  WHEN EXISTS (SELECT 1 FROM assistant_night_runs n WHERE n.job_id = j.id)
    THEN 'overnight'
  WHEN j.run_state IS NULL AND j.run_origin = 'night' THEN 'overnight'
  WHEN j.run_state IS NULL AND j.run_origin <> 'person' THEN 'background'
  ELSE assistant_runtime_lane(j.run_state)
END;
ALTER TABLE ai_jobs ALTER COLUMN runtime_lane SET NOT NULL;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_runtime_lane_check
  CHECK (runtime_lane IN ('interactive', 'background', 'overnight'));

CREATE FUNCTION keep_assistant_runtime_lane() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    expected := assistant_runtime_lane(NEW.run_state);
    IF NEW.runtime_lane IS NOT NULL AND NEW.runtime_lane <> expected THEN
      RAISE EXCEPTION 'Assistant runtime lane does not match its request';
    END IF;
    NEW.runtime_lane := expected;
  ELSIF NEW.runtime_lane IS DISTINCT FROM OLD.runtime_lane THEN
    RAISE EXCEPTION 'Assistant runtime ownership cannot change';
  ELSIF NEW.run_state->>'version' = '1'
    AND NEW.run_state->'request' IS NOT NULL
    AND NEW.run_state->'request' IS DISTINCT FROM OLD.run_state->'request'
    AND assistant_runtime_lane(NEW.run_state) <> OLD.runtime_lane THEN
    RAISE EXCEPTION 'Assistant request cannot move to another runtime';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ai_jobs_runtime_lane BEFORE INSERT OR UPDATE ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION keep_assistant_runtime_lane();

CREATE INDEX ai_jobs_runtime_queue ON ai_jobs(runtime_lane, created_at, id)
WHERE state = 'queued' AND run_state->>'version' = '1';
