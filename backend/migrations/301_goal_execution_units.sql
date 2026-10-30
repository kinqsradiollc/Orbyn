-- Keep charged Review attempts open until their unit frontier has consumed the decision.
ALTER TABLE assistant_goal_attempts ADD COLUMN processed_at timestamptz;
UPDATE assistant_goal_attempts a SET processed_at=a.settled_at
WHERE a.settled_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM assistant_goal_executions e CROSS JOIN LATERAL jsonb_array_elements(e.units) u
  WHERE e.id=a.execution_id AND e.current_job_id=a.job_id
    AND u->>'id'=a.unit_id::text AND u->>'pending_proposal_id' IS NOT NULL
);
DROP INDEX assistant_goal_one_unsettled_attempt;
CREATE UNIQUE INDEX assistant_goal_one_open_unit_attempt
  ON assistant_goal_attempts(execution_id,unit_id) WHERE processed_at IS NULL;
ALTER TABLE assistant_goal_attempts ADD CONSTRAINT assistant_goal_processed_settled
  CHECK(processed_at IS NULL OR settled_at IS NOT NULL);

-- Only a waiting unit of the same explicit execution yields its goal ownership.
-- Attempt rows and captured bindings validate identity; no model-generated identity is trusted alone.
CREATE FUNCTION assistant_goal_waiting_overlap(candidate_job uuid,busy_job uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM ai_jobs candidate JOIN assistant_goal_attempts ca ON ca.job_id=candidate.id
    JOIN assistant_goal_executions e ON e.id=ca.execution_id
    JOIN assistant_goal_attempts ba ON ba.execution_id=e.id
    JOIN ai_jobs busy ON busy.id=ba.job_id
    WHERE candidate.id=candidate_job AND busy.id=busy_job AND busy.state='waiting'
      AND ca.processed_at IS NULL AND ba.processed_at IS NULL AND ca.unit_id<>ba.unit_id
      AND ca.generation=e.generation AND ba.generation=e.generation
      AND e.state NOT IN ('stopped','completed')
      AND candidate.user_id=e.owner_id AND busy.user_id=e.owner_id
      AND ca.owner_id=e.owner_id AND ba.owner_id=e.owner_id
      AND candidate.work_source_kind='goal' AND busy.work_source_kind='goal'
      AND candidate.work_source_id=e.goal_id AND busy.work_source_id=e.goal_id
      AND candidate.run_state->'request'->'automation'->'goal_execution'->>'id'=e.id::text
      AND busy.run_state->'request'->'automation'->'goal_execution'->>'id'=e.id::text
      AND candidate.run_state->'request'->'automation'->'goal_execution'->>'unit_id'=ca.unit_id::text
      AND busy.run_state->'request'->'automation'->'goal_execution'->>'unit_id'=ba.unit_id::text
      AND candidate.run_state->'request'->'automation'->'goal_execution'->>'generation'=e.generation::text
      AND busy.run_state->'request'->'automation'->'goal_execution'->>'generation'=e.generation::text
      AND candidate.run_state->'request'->'automation'->'goal_execution'->>'mode'=ca.mode
      AND busy.run_state->'request'->'automation'->'goal_execution'->>'mode'=ba.mode
  )
$$;

CREATE OR REPLACE FUNCTION guard_assistant_work_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb; acquiring boolean;
BEGIN
  expected := assistant_work_source(NEW.run_state);
  IF TG_OP='INSERT' THEN
    IF NEW.work_source_kind IS NOT NULL OR NEW.work_source_id IS NOT NULL THEN
      IF ROW(NEW.work_source_kind,NEW.work_source_id) IS DISTINCT FROM
        ROW(expected->>'kind',(expected->>'id')::uuid) THEN
        RAISE EXCEPTION 'Assigned assistant work does not match its checkpoint';
      END IF;
    END IF;
    NEW.work_source_kind := expected->>'kind';
    NEW.work_source_id := (expected->>'id')::uuid;
    acquiring := true;
  ELSE
    IF ROW(NEW.work_source_kind,NEW.work_source_id) IS DISTINCT FROM ROW(OLD.work_source_kind,OLD.work_source_id)
      OR (OLD.work_source_id IS NOT NULL AND NEW.user_id<>OLD.user_id) THEN
      RAISE EXCEPTION 'Assigned assistant work ownership cannot change';
    END IF;
    IF NEW.run_state->'request' IS NOT NULL AND ROW(NEW.work_source_kind,NEW.work_source_id)
      IS DISTINCT FROM ROW(expected->>'kind',(expected->>'id')::uuid) THEN
      RAISE EXCEPTION 'Assistant checkpoint cannot change its assigned work';
    END IF;
    acquiring := OLD.state NOT IN ('running','waiting') OR (OLD.state='waiting' AND NEW.state='running');
  END IF;
  IF acquiring AND NEW.state IN ('running','waiting') AND NEW.work_source_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant-work:' || NEW.work_source_kind || ':' || NEW.work_source_id::text,209));
    IF EXISTS(SELECT 1 FROM ai_jobs busy WHERE busy.id<>NEW.id
      AND busy.work_source_kind=NEW.work_source_kind AND busy.work_source_id=NEW.work_source_id
      AND busy.state IN ('running','waiting') AND NOT assistant_goal_waiting_overlap(NEW.id,busy.id)) THEN
      RAISE EXCEPTION 'This assigned work already has an active assistant job' USING ERRCODE='55P03';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- Accounting and frontier consumption are one-way; job retention may still clear job_id.
CREATE FUNCTION guard_assistant_goal_attempt_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN
    RAISE EXCEPTION 'Consumed goal attempts cannot reopen or change consumption time';
  END IF;
  IF OLD.settled_at IS NOT NULL AND ROW(NEW.settled_at,NEW.settled_tokens)
    IS DISTINCT FROM ROW(OLD.settled_at,OLD.settled_tokens) THEN
    RAISE EXCEPTION 'Settled goal attempt accounting cannot change';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_goal_attempt_settlement_guard BEFORE UPDATE ON assistant_goal_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_goal_attempt_settlement();
