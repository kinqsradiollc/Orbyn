-- Persist assigned work identity after completion clears its checkpoint.
CREATE FUNCTION assistant_work_source(checkpoint jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN kind IN ('task','goal','routine')
    AND id ~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    THEN jsonb_build_object('kind',kind,'id',id::uuid) ELSE NULL END
  FROM (SELECT coalesce(checkpoint->'request'->'automation'->>'source_kind',
    checkpoint->'request'->'automation'->>'kind') AS kind,
    checkpoint->'request'->'automation'->>'id' AS id) identity
$$;

ALTER TABLE ai_jobs ADD COLUMN work_source_kind text;
ALTER TABLE ai_jobs ADD COLUMN work_source_id uuid;
UPDATE ai_jobs SET work_source_kind=assistant_work_source(run_state)->>'kind',
  work_source_id=(assistant_work_source(run_state)->>'id')::uuid;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_work_source_check CHECK (
  (work_source_kind IS NULL AND work_source_id IS NULL) OR
  (work_source_kind IS NOT NULL AND work_source_kind IN ('task','goal','routine') AND work_source_id IS NOT NULL));

-- Non-unique on purpose: upgrades preserve existing waiting IDs and active work.
-- Existing overlapping runs may finish, but no additional owner can acquire it.
CREATE INDEX ai_jobs_work_source_active ON ai_jobs(user_id,work_source_kind,work_source_id)
  WHERE state IN ('running','waiting');

CREATE FUNCTION guard_assistant_work_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb; acquiring boolean;
BEGIN
  expected := assistant_work_source(NEW.run_state);
  IF TG_OP = 'INSERT' THEN
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
    IF ROW(NEW.work_source_kind,NEW.work_source_id) IS DISTINCT FROM
      ROW(OLD.work_source_kind,OLD.work_source_id)
      OR (OLD.work_source_id IS NOT NULL AND NEW.user_id <> OLD.user_id) THEN
      RAISE EXCEPTION 'Assigned assistant work ownership cannot change';
    END IF;
    IF NEW.run_state->'request' IS NOT NULL AND ROW(NEW.work_source_kind,NEW.work_source_id)
      IS DISTINCT FROM ROW(expected->>'kind',(expected->>'id')::uuid) THEN
      RAISE EXCEPTION 'Assistant checkpoint cannot change its assigned work';
    END IF;
    acquiring := OLD.state NOT IN ('running','waiting');
  END IF;
  IF acquiring AND NEW.state IN ('running','waiting') AND NEW.work_source_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('assistant-work:' || NEW.user_id::text || ':' ||
      NEW.work_source_kind || ':' || NEW.work_source_id::text,209));
    IF EXISTS(SELECT 1 FROM ai_jobs busy WHERE busy.id<>NEW.id AND busy.user_id=NEW.user_id
      AND busy.work_source_kind=NEW.work_source_kind AND busy.work_source_id=NEW.work_source_id
      AND busy.state IN ('running','waiting')) THEN
      RAISE EXCEPTION 'This assigned work already has an active assistant job' USING ERRCODE='55P03';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER ai_jobs_work_owner BEFORE INSERT OR UPDATE ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_work_owner();
