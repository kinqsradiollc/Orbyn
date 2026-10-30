ALTER TABLE ai_jobs ADD COLUMN cancel_reason text CHECK(cancel_reason IN ('stopped','deadline'));

-- Retry policy is deliberately separate from the strict, model-editable routine DTO.
ALTER TABLE agent_routines
  ADD COLUMN retry_policy jsonb CHECK(retry_policy IS NULL OR jsonb_typeof(retry_policy)='object'),
  ADD COLUMN retry_policy_revision integer NOT NULL DEFAULT 1 CHECK(retry_policy_revision>0),
  ADD COLUMN retry_policy_last_control jsonb,
  ADD COLUMN recovery_intent_version integer NOT NULL DEFAULT 1 CHECK(recovery_intent_version>0);

-- No legacy occurrence is implicitly eligible for retry.
ALTER TABLE assistant_routine_runs
  ADD COLUMN recovery_version smallint CHECK(recovery_version=1),
  ADD COLUMN recovery_state text CHECK(recovery_state IN ('active','waiting','retry_scheduled','held','limited','completed','stopped')),
  ADD COLUMN lane text CHECK(lane IN ('background','overnight')),
  ADD COLUMN policy_snapshot jsonb,
  ADD COLUMN policy_revision integer,
  ADD COLUMN intent_version integer,
  ADD COLUMN instruction_snapshot text,
  ADD COLUMN config_hash text,
  ADD COLUMN provider_hash text,
  ADD COLUMN scope_hash text,
  ADD COLUMN schedule_exhausted boolean,
  ADD COLUMN deadline timestamptz,
  ADD COLUMN destination_id uuid REFERENCES assistant_conversation_streams ON DELETE SET NULL,
  ADD COLUMN personal_only boolean,
  ADD COLUMN generation integer,
  ADD COLUMN revision integer,
  ADD COLUMN attempt_count integer,
  ADD COLUMN consumed_tokens integer,
  ADD COLUMN reserved_tokens integer,
  ADD COLUMN next_eligible_at timestamptz,
  ADD COLUMN last_transition_reason text,
  ADD COLUMN last_control jsonb,
  ADD COLUMN recovery_created_at timestamptz,
  ADD COLUMN recovery_updated_at timestamptz,
  ADD CONSTRAINT routine_recovery_metadata CHECK(recovery_version IS NULL OR COALESCE((
    recovery_state IS NOT NULL AND lane IS NOT NULL AND jsonb_typeof(policy_snapshot)='object'
    AND policy_snapshot IS NOT NULL AND policy_revision>0 AND intent_version>0
    AND instruction_snapshot IS NOT NULL AND config_hash IS NOT NULL AND provider_hash IS NOT NULL AND scope_hash IS NOT NULL
    AND schedule_exhausted IS NOT NULL AND deadline IS NOT NULL AND personal_only IS NOT NULL
    AND generation>0 AND revision>0 AND attempt_count BETWEEN 1 AND 5
    AND consumed_tokens>=0 AND reserved_tokens>=0 AND last_transition_reason IS NOT NULL
    AND recovery_created_at IS NOT NULL AND recovery_updated_at IS NOT NULL),false));
CREATE INDEX assistant_routine_recovery_due ON assistant_routine_runs(lane,next_eligible_at,id)
  WHERE recovery_version=1 AND recovery_state='retry_scheduled';

CREATE FUNCTION guard_routine_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.recovery_version,NEW.lane,NEW.policy_snapshot,NEW.policy_revision,NEW.intent_version,
    NEW.instruction_snapshot,NEW.config_hash,NEW.provider_hash,NEW.scope_hash,NEW.schedule_exhausted,
    NEW.deadline,NEW.personal_only,NEW.recovery_created_at)
    IS DISTINCT FROM ROW(OLD.recovery_version,OLD.lane,OLD.policy_snapshot,OLD.policy_revision,OLD.intent_version,
    OLD.instruction_snapshot,OLD.config_hash,OLD.provider_hash,OLD.scope_hash,OLD.schedule_exhausted,
    OLD.deadline,OLD.personal_only,OLD.recovery_created_at) THEN
    RAISE EXCEPTION 'Routine recovery admission identity cannot change';
  END IF;
  IF NEW.recovery_version=1 AND (NEW.generation<OLD.generation OR NEW.revision<OLD.revision
    OR NEW.attempt_count<OLD.attempt_count OR NEW.consumed_tokens<OLD.consumed_tokens
    OR (OLD.recovery_state IN ('completed','stopped') AND NEW.recovery_state<>OLD.recovery_state)) THEN
    RAISE EXCEPTION 'Routine recovery cannot reopen or erase accounting';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_routine_recovery_guard BEFORE UPDATE ON assistant_routine_runs
  FOR EACH ROW EXECUTE FUNCTION guard_routine_recovery();

CREATE TABLE assistant_routine_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES assistant_routine_runs ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 5),
  parent_attempt_id uuid UNIQUE REFERENCES assistant_routine_attempts ON DELETE SET NULL,
  job_id uuid UNIQUE REFERENCES ai_jobs ON DELETE SET NULL,
  generation integer NOT NULL CHECK(generation>0),
  allocated_tokens integer NOT NULL CHECK(allocated_tokens>=0),
  settled_tokens integer CHECK(settled_tokens>=0),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','waiting','done','failed','unavailable')),
  terminal_evidence jsonb,
  result_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  UNIQUE(occurrence_id,ordinal),
  CHECK((settled_at IS NULL AND settled_tokens IS NULL) OR (settled_at IS NOT NULL AND settled_tokens IS NOT NULL)),
  CHECK(ordinal<>1 OR parent_attempt_id IS NULL)
);
CREATE UNIQUE INDEX assistant_routine_one_unsettled_attempt ON assistant_routine_attempts(occurrence_id) WHERE settled_at IS NULL;
CREATE FUNCTION guard_routine_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE occurrence assistant_routine_runs;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO occurrence FROM assistant_routine_runs WHERE id=NEW.occurrence_id;
    IF NOT FOUND OR occurrence.owner_id<>NEW.owner_id OR occurrence.recovery_version IS DISTINCT FROM 1
      OR occurrence.generation<>NEW.generation OR NEW.ordinal>(occurrence.policy_snapshot->>'max_attempts')::integer THEN
      RAISE EXCEPTION 'Routine attempt does not match its occurrence';
    END IF;
    IF NEW.job_id IS NULL OR NOT EXISTS(SELECT 1 FROM ai_jobs j WHERE j.id=NEW.job_id
      AND j.user_id=NEW.owner_id AND j.work_source_kind='routine' AND j.work_source_id=occurrence.routine_id
      AND j.run_state#>>'{request,automation,routine_recovery,occurrence_id}'=occurrence.id::text
      AND j.run_state#>>'{request,automation,routine_recovery,attempt_id}'=NEW.id::text
      AND j.run_state#>>'{request,automation,routine_recovery,generation}'=NEW.generation::text
      AND j.run_state#>>'{request,automation,routine_recovery,ordinal}'=NEW.ordinal::text) THEN
      RAISE EXCEPTION 'Routine attempt job identity does not match';
    END IF;
    IF NEW.ordinal=1 AND NEW.job_id IS DISTINCT FROM occurrence.job_id THEN
      RAISE EXCEPTION 'Initial routine attempt must match its occurrence receipt';
    END IF;
    IF NEW.ordinal>1 AND NOT EXISTS(SELECT 1 FROM assistant_routine_attempts p WHERE p.id=NEW.parent_attempt_id
      AND p.occurrence_id=NEW.occurrence_id AND p.ordinal=NEW.ordinal-1 AND p.settled_at IS NOT NULL
      AND p.terminal_evidence->>'version'='1' AND p.terminal_evidence->>'job_id'=p.job_id::text
      AND p.terminal_evidence->>'retry'='eligible' AND p.terminal_evidence->>'effects'='none') THEN
      RAISE EXCEPTION 'Routine retry predecessor does not match';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.occurrence_id,NEW.owner_id,NEW.ordinal,NEW.generation,NEW.allocated_tokens,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.occurrence_id,OLD.owner_id,OLD.ordinal,OLD.generation,OLD.allocated_tokens,OLD.created_at)
      OR (NEW.parent_attempt_id IS DISTINCT FROM OLD.parent_attempt_id AND NEW.parent_attempt_id IS NOT NULL)
      OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL)
      OR (OLD.settled_at IS NOT NULL AND ROW(NEW.settled_at,NEW.settled_tokens,NEW.terminal_evidence,NEW.result_digest)
        IS DISTINCT FROM ROW(OLD.settled_at,OLD.settled_tokens,OLD.terminal_evidence,OLD.result_digest)) THEN
      RAISE EXCEPTION 'Routine attempt identity and settled accounting cannot change';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_routine_attempt_guard BEFORE INSERT OR UPDATE ON assistant_routine_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_routine_attempt();
CREATE FUNCTION observe_routine_attempt_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE assistant_routine_attempts SET state=NEW.state WHERE job_id=NEW.id;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_routine_attempt_job_state AFTER UPDATE OF state ON ai_jobs
  FOR EACH ROW WHEN(OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION observe_routine_attempt_job();
