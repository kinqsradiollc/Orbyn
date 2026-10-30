-- Explicit finite watch configuration; strict existing routine DTOs remain unchanged.
ALTER TABLE agent_routines
  ADD COLUMN quiet_check_policy jsonb CHECK(quiet_check_policy IS NULL OR jsonb_typeof(quiet_check_policy)='object'),
  ADD COLUMN quiet_check_revision integer NOT NULL DEFAULT 1 CHECK(quiet_check_revision>0),
  ADD COLUMN quiet_check_last_control jsonb;
CREATE TABLE assistant_quiet_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  routine_id uuid NOT NULL REFERENCES agent_routines ON DELETE CASCADE,
  occurrence_id uuid REFERENCES assistant_routine_runs ON DELETE CASCADE,
  job_id uuid UNIQUE REFERENCES ai_jobs ON DELETE SET NULL,
  lane text NOT NULL CHECK(lane IN ('background','overnight')),
  policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(policy_snapshot)='object'),
  projection_version smallint NOT NULL CHECK(projection_version=1),
  config_hash text NOT NULL,
  provider_hash text NOT NULL,
  scope_hash text NOT NULL,
  intent_version integer NOT NULL CHECK(intent_version>0),
  baseline_check_id uuid REFERENCES assistant_quiet_checks ON DELETE SET NULL,
  requested boolean NOT NULL DEFAULT false,
  decision_seen boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','baseline','verified_unchanged','changed','reported','incomplete')),
  reason text NOT NULL DEFAULT 'The selected sources have not all been checked.',
  expected_count integer NOT NULL CHECK(expected_count BETWEEN 1 AND 20),
  checked_count integer NOT NULL DEFAULT 0 CHECK(checked_count BETWEEN 0 AND 20),
  observed_at timestamptz,
  snapshot_aggregate jsonb CHECK(snapshot_aggregate IS NULL OR jsonb_typeof(snapshot_aggregate)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(checked_count<=expected_count),
  CHECK(status='pending' OR observed_at IS NOT NULL),
  CHECK(status<>'verified_unchanged' OR (requested AND checked_count=expected_count AND snapshot_aggregate IS NOT NULL))
);
CREATE INDEX assistant_quiet_check_history ON assistant_quiet_checks(owner_id,routine_id,created_at DESC,id DESC);
CREATE FUNCTION guard_assistant_quiet_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS(SELECT 1 FROM agent_routines r WHERE r.id=NEW.routine_id AND r.user_id=NEW.owner_id)
      OR NEW.job_id IS NULL OR NOT EXISTS(SELECT 1 FROM ai_jobs j WHERE j.id=NEW.job_id AND j.user_id=NEW.owner_id
        AND j.work_source_kind='routine' AND j.work_source_id=NEW.routine_id)
      OR (NEW.occurrence_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_routine_runs r
        WHERE r.id=NEW.occurrence_id AND r.owner_id=NEW.owner_id AND r.routine_id=NEW.routine_id)) THEN
      RAISE EXCEPTION 'Quiet check does not match its routine, occurrence or job';
    END IF;
    IF NEW.baseline_check_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_quiet_checks b
      WHERE b.id=NEW.baseline_check_id AND b.owner_id=NEW.owner_id AND b.routine_id=NEW.routine_id
      AND b.config_hash=NEW.config_hash AND b.projection_version=NEW.projection_version AND b.job_id IS NOT NULL
      AND b.status IN ('baseline','verified_unchanged','changed','reported') AND b.checked_count=b.expected_count AND b.snapshot_aggregate IS NOT NULL) THEN
      RAISE EXCEPTION 'Quiet baseline must be a complete compatible retained check';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.owner_id,NEW.routine_id,NEW.occurrence_id,NEW.lane,NEW.policy_snapshot,NEW.projection_version,
      NEW.config_hash,NEW.provider_hash,NEW.scope_hash,NEW.intent_version,NEW.expected_count,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.routine_id,OLD.occurrence_id,OLD.lane,OLD.policy_snapshot,OLD.projection_version,
      OLD.config_hash,OLD.provider_hash,OLD.scope_hash,OLD.intent_version,OLD.expected_count,OLD.created_at)
      OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL)
      OR (NEW.baseline_check_id IS DISTINCT FROM OLD.baseline_check_id AND NEW.baseline_check_id IS NOT NULL)
      OR (OLD.requested AND NOT NEW.requested)
      OR (OLD.decision_seen AND NOT NEW.decision_seen)
      OR (OLD.status<>'pending' AND ROW(NEW.status,NEW.reason,NEW.checked_count,NEW.observed_at,NEW.snapshot_aggregate)
        IS DISTINCT FROM ROW(OLD.status,OLD.reason,OLD.checked_count,OLD.observed_at,OLD.snapshot_aggregate)) THEN
      RAISE EXCEPTION 'Quiet check identity and settled evidence cannot change';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_quiet_check_guard BEFORE INSERT OR UPDATE ON assistant_quiet_checks
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_quiet_check();
CREATE TABLE assistant_quiet_read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES assistant_quiet_checks ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('task','doc')),
  source_id uuid NOT NULL,
  revision text NOT NULL,
  digest text NOT NULL,
  start_index integer NOT NULL CHECK(start_index>=0),
  end_index integer NOT NULL,
  total integer NOT NULL CHECK(total>=0),
  complete boolean NOT NULL,
  supported boolean NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(end_index>=start_index AND end_index<=total)
);
CREATE INDEX assistant_quiet_read_check ON assistant_quiet_read_receipts(check_id,source_kind,source_id,observed_at,id);
CREATE FUNCTION guard_assistant_quiet_read_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c assistant_quiet_checks;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Quiet read receipts cannot change'; END IF;
  SELECT * INTO c FROM assistant_quiet_checks WHERE id=NEW.check_id FOR UPDATE;
  IF NOT FOUND OR c.status<>'pending' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.policy_snapshot->'sources') s
    WHERE s->>'kind'=NEW.source_kind AND s->>'id'=NEW.source_id::text)
    OR (SELECT count(*) FROM assistant_quiet_read_receipts WHERE check_id=NEW.check_id)>=200 THEN
    RAISE EXCEPTION 'Quiet read does not match a pending bounded source check';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_quiet_read_receipt_guard BEFORE INSERT OR UPDATE ON assistant_quiet_read_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_quiet_read_receipt();
