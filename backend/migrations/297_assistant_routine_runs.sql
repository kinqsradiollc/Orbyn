-- Occurrence receipts only: ai_jobs and the existing scanners still own execution.
-- No historical schedule timestamps can be inferred safely, so there is no backfill.
CREATE TABLE assistant_routine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  routine_id uuid NOT NULL REFERENCES agent_routines ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  job_id uuid UNIQUE REFERENCES ai_jobs ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('queued','running','waiting','done','failed')),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resume_count integer NOT NULL DEFAULT 0 CHECK (resume_count >= 0),
  UNIQUE(routine_id,scheduled_for)
);
CREATE INDEX assistant_routine_runs_history ON assistant_routine_runs(owner_id,routine_id,scheduled_for DESC,id DESC);

CREATE FUNCTION guard_assistant_routine_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job ai_jobs;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id,NEW.owner_id,NEW.routine_id,NEW.scheduled_for) IS DISTINCT FROM
       ROW(OLD.id,OLD.owner_id,OLD.routine_id,OLD.scheduled_for)
       OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Routine occurrence identity cannot change';
    END IF;
    -- Retention may detach the job, but never copies its result into this ledger.
    RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM agent_routines WHERE id=NEW.routine_id AND user_id=NEW.owner_id) THEN
    RAISE EXCEPTION 'Routine occurrence owner does not match its routine';
  END IF;
  SELECT * INTO job FROM ai_jobs WHERE id=NEW.job_id FOR SHARE;
  IF NOT FOUND OR job.user_id<>NEW.owner_id OR job.work_source_kind IS DISTINCT FROM 'routine'
     OR job.work_source_id IS DISTINCT FROM NEW.routine_id THEN
    RAISE EXCEPTION 'Routine occurrence does not match its execution';
  END IF;
  NEW.state := job.state;
  NEW.resume_count := job.resume_count;
  NEW.last_observed_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_routine_run_identity BEFORE INSERT OR UPDATE ON assistant_routine_runs
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_routine_run();

-- Every execution writer (including restart recovery) updates the receipt in the
-- same transaction. This does not enqueue, retry, or alter a schedule.
CREATE FUNCTION observe_assistant_routine_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE assistant_routine_runs SET state=NEW.state,resume_count=NEW.resume_count,
    last_observed_at=clock_timestamp() WHERE job_id=NEW.id;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_routine_job_observed AFTER UPDATE OF state,resume_count ON ai_jobs
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state OR OLD.resume_count IS DISTINCT FROM NEW.resume_count)
  EXECUTE FUNCTION observe_assistant_routine_job();
