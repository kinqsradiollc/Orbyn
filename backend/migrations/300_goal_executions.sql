-- Explicit goal work is separate from weekly planner check-ins. Jobs remain the
-- only execution queue; these rows retain intent, frontier and accounting.
CREATE TABLE assistant_goal_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES goals ON DELETE CASCADE,
  start_request_id uuid NOT NULL,
  start_digest text NOT NULL,
  criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='array' AND jsonb_array_length(criteria) BETWEEN 1 AND 10),
  units jsonb NOT NULL CHECK(jsonb_typeof(units)='array' AND jsonb_array_length(units) BETWEEN 1 AND 10),
  state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','active','waiting','awaiting_acceptance','limited','held','failed','stopped','completed')),
  admissions_paused boolean NOT NULL DEFAULT false,
  generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  lane text NOT NULL CHECK(lane IN ('background','overnight')),
  effect_ceiling text NOT NULL CHECK(effect_ceiling IN ('suggest','existing_scopes')),
  criteria_hash text NOT NULL,
  config_hash text NOT NULL,
  provider_hash text NOT NULL,
  scope_hash text NOT NULL,
  destination_id uuid REFERENCES assistant_conversation_streams ON DELETE SET NULL,
  personal_only boolean NOT NULL DEFAULT true,
  limits jsonb NOT NULL CHECK(jsonb_typeof(limits)='object'),
  consumed_tokens integer NOT NULL DEFAULT 0 CHECK(consumed_tokens>=0),
  reserved_tokens integer NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  frontier_revision integer NOT NULL DEFAULT 1 CHECK(frontier_revision>0),
  evidence_revision integer NOT NULL DEFAULT 0 CHECK(evidence_revision>=0),
  current_job_id uuid REFERENCES ai_jobs ON DELETE SET NULL,
  acceptance jsonb CHECK(acceptance IS NULL OR jsonb_typeof(acceptance)='object'),
  last_control jsonb,
  last_transition_reason text NOT NULL DEFAULT 'Ready for bounded work',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id,start_request_id),
  CHECK(state<>'completed' OR acceptance IS NOT NULL)
);
CREATE UNIQUE INDEX assistant_goal_one_open_execution ON assistant_goal_executions(goal_id)
  WHERE state NOT IN ('stopped','completed');
CREATE INDEX assistant_goal_execution_history ON assistant_goal_executions(owner_id,goal_id,created_at DESC,id DESC);

CREATE FUNCTION guard_assistant_goal_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM goals WHERE id=NEW.goal_id AND user_id=NEW.owner_id) THEN
    RAISE EXCEPTION 'Goal execution owner does not match its goal';
  END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.owner_id,NEW.goal_id,NEW.start_request_id,NEW.start_digest,
      NEW.criteria,NEW.criteria_hash,NEW.config_hash,NEW.provider_hash,NEW.scope_hash,NEW.lane,NEW.effect_ceiling,NEW.limits)
    IS DISTINCT FROM ROW(OLD.owner_id,OLD.goal_id,OLD.start_request_id,OLD.start_digest,
      OLD.criteria,OLD.criteria_hash,OLD.config_hash,OLD.provider_hash,OLD.scope_hash,OLD.lane,OLD.effect_ceiling,OLD.limits)
    OR (OLD.acceptance IS NOT NULL AND NEW.acceptance IS DISTINCT FROM OLD.acceptance)) THEN
    RAISE EXCEPTION 'Reviewed goal execution identity cannot change';
  END IF;
  IF jsonb_array_length(NEW.units)<>jsonb_array_length(NEW.criteria)
    OR (SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(NEW.criteria) c)<>jsonb_array_length(NEW.criteria)
    OR (SELECT count(DISTINCT u->>'id') FROM jsonb_array_elements(NEW.units) u)<>jsonb_array_length(NEW.units)
    OR (SELECT count(DISTINCT u->>'criterion_id') FROM jsonb_array_elements(NEW.units) u)<>jsonb_array_length(NEW.units)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.units) u WHERE NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(NEW.criteria) c WHERE c->>'id'=u->>'criterion_id')) THEN
    RAISE EXCEPTION 'Goal execution units do not match its criteria';
  END IF;
  IF TG_OP='UPDATE' AND
    (SELECT jsonb_agg(jsonb_build_array(u->>'id',u->>'criterion_id') ORDER BY u->>'id') FROM jsonb_array_elements(NEW.units) u)
    IS DISTINCT FROM
    (SELECT jsonb_agg(jsonb_build_array(u->>'id',u->>'criterion_id') ORDER BY u->>'id') FROM jsonb_array_elements(OLD.units) u) THEN
    RAISE EXCEPTION 'Goal execution unit identities cannot change';
  END IF;
  IF NEW.current_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_jobs j
    WHERE j.id=NEW.current_job_id AND j.user_id=NEW.owner_id AND j.work_source_kind='goal' AND j.work_source_id=NEW.goal_id) THEN
    RAISE EXCEPTION 'Goal execution job does not match its owner and goal';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_goal_execution_guard BEFORE INSERT OR UPDATE ON assistant_goal_executions
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_goal_execution();

CREATE TABLE assistant_goal_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES assistant_goal_executions ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK(ordinal>0),
  mode text NOT NULL CHECK(mode IN ('work','verify','repair')),
  relation text NOT NULL CHECK(relation IN ('initial','continue','retry')),
  parent_attempt_id uuid REFERENCES assistant_goal_attempts ON DELETE SET NULL,
  job_id uuid UNIQUE REFERENCES ai_jobs ON DELETE SET NULL,
  generation integer NOT NULL CHECK(generation>0),
  input_frontier_revision integer NOT NULL CHECK(input_frontier_revision>0),
  allocated_tokens integer NOT NULL CHECK(allocated_tokens>=0),
  settled_tokens integer CHECK(settled_tokens>=0),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','waiting','done','failed','unavailable')),
  terminal_evidence jsonb,
  result_digest text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  UNIQUE(execution_id,ordinal),
  CHECK((settled_at IS NULL AND settled_tokens IS NULL) OR (settled_at IS NOT NULL AND settled_tokens IS NOT NULL))
);
CREATE UNIQUE INDEX assistant_goal_one_unsettled_attempt ON assistant_goal_attempts(execution_id) WHERE settled_at IS NULL;
CREATE INDEX assistant_goal_attempt_history ON assistant_goal_attempts(execution_id,created_at DESC,id DESC);

CREATE FUNCTION guard_assistant_goal_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE execution assistant_goal_executions;
BEGIN
  IF TG_OP='INSERT' THEN
  SELECT * INTO execution FROM assistant_goal_executions WHERE id=NEW.execution_id;
  IF NOT FOUND OR execution.owner_id<>NEW.owner_id OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(execution.units) u WHERE u->>'id'=NEW.unit_id::text) THEN
    RAISE EXCEPTION 'Goal attempt owner or unit does not match its execution';
  END IF;
  IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ai_jobs j WHERE j.id=NEW.job_id
    AND j.user_id=NEW.owner_id AND j.work_source_kind='goal' AND j.work_source_id=execution.goal_id) THEN
    RAISE EXCEPTION 'Goal attempt job does not match its execution';
  END IF;
  IF NEW.parent_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_goal_attempts p
    WHERE p.id=NEW.parent_attempt_id AND p.execution_id=NEW.execution_id AND p.ordinal<NEW.ordinal) THEN
    RAISE EXCEPTION 'Goal attempt predecessor does not match its execution';
  END IF;
  END IF;
  IF TG_OP='UPDATE' AND (ROW(NEW.execution_id,NEW.owner_id,NEW.unit_id,NEW.ordinal,NEW.generation,
      NEW.mode,NEW.relation,NEW.allocated_tokens,NEW.input_frontier_revision)
    IS DISTINCT FROM ROW(OLD.execution_id,OLD.owner_id,OLD.unit_id,OLD.ordinal,OLD.generation,
      OLD.mode,OLD.relation,OLD.allocated_tokens,OLD.input_frontier_revision)
    OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Goal attempt identity cannot change';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_goal_attempt_guard BEFORE INSERT OR UPDATE ON assistant_goal_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_goal_attempt();

CREATE FUNCTION observe_assistant_goal_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE assistant_goal_attempts SET state=NEW.state WHERE job_id=NEW.id;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_goal_attempt_job_state AFTER UPDATE OF state ON ai_jobs
  FOR EACH ROW WHEN(OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION observe_assistant_goal_attempt();
