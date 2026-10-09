-- Storage only. Delivery is enabled only after current policy/source/budget checks
-- and transactional recipient creation are wired into the separate workers.
CREATE TABLE assistant_handoff_chains (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  receipt_count smallint NOT NULL CHECK (receipt_count BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES assistant_handoffs ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    REFERENCES assistant_handoff_chains ON DELETE CASCADE,
  parent_id uuid REFERENCES assistant_handoffs ON DELETE CASCADE,
  depth smallint NOT NULL CHECK (depth BETWEEN 0 AND 3),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  producer_lane text NOT NULL CHECK (producer_lane IN ('background','overnight')),
  recipient_lane text NOT NULL CHECK (recipient_lane IN ('background','overnight') AND recipient_lane <> producer_lane),
  producer_job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE,
  producer_revision text NOT NULL CHECK (length(btrim(producer_revision)) BETWEEN 1 AND 128),
  recipient_job_id uuid UNIQUE REFERENCES ai_jobs ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  instruction text NOT NULL CHECK (length(btrim(instruction)) BETWEEN 1 AND 4000),
  sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','completed','failed','cancelled')),
  delivery_attempts smallint NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 3),
  result jsonb,
  failure text CHECK (failure IN ('access','revision','policy','connection','budget','delivery','execution')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now() CHECK (updated_at >= created_at),
  CHECK (recipient_job_id IS DISTINCT FROM producer_job_id),
  CHECK ((status <> 'proposed' OR recipient_job_id IS NULL)
    AND (status NOT IN ('accepted','completed') OR (recipient_job_id IS NOT NULL AND delivery_attempts > 0))),
  CHECK ((status = 'failed') = (failure IS NOT NULL)),
  CHECK (coalesce((status = 'completed' AND result IS NOT NULL AND result->>'kind' = 'job'
    AND jsonb_typeof(result->'revision') = 'string'
    AND result->>'id' = recipient_job_id::text AND length(btrim(result->>'revision')) BETWEEN 1 AND 128)
    OR (status <> 'completed' AND result IS NULL),false)),
  CHECK (delivery_attempts <= 3)
);

CREATE UNIQUE INDEX assistant_handoffs_active_result ON assistant_handoffs
  (owner_id,producer_job_id,producer_revision,recipient_lane)
  WHERE status NOT IN ('failed','cancelled');

CREATE INDEX assistant_handoffs_queue ON assistant_handoffs(recipient_lane,created_at,id)
  WHERE status = 'proposed';
CREATE INDEX assistant_handoffs_chain ON assistant_handoffs(root_id);
CREATE INDEX assistant_handoffs_owner ON assistant_handoffs(owner_id,created_at DESC);

CREATE FUNCTION guard_assistant_handoff() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE producer ai_jobs%ROWTYPE; recipient ai_jobs%ROWTYPE; parent assistant_handoffs%ROWTYPE; source jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Hash collisions only serialize unrelated chains; they never relax bounds.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.root_id::text,208));
    IF NEW.status <> 'proposed' OR NEW.revision <> 1 OR NEW.delivery_attempts <> 0 THEN
      RAISE EXCEPTION 'New handoffs must start as unattempted proposals';
    END IF;
    IF NEW.parent_id IS NULL THEN
      IF NEW.root_id <> NEW.id OR NEW.depth <> 0 THEN
        RAISE EXCEPTION 'Invalid root handoff';
      END IF;
      INSERT INTO assistant_handoff_chains(id,owner_id,receipt_count) VALUES(NEW.id,NEW.owner_id,1);
    ELSE
      SELECT * INTO parent FROM assistant_handoffs WHERE id = NEW.parent_id FOR SHARE;
      IF NOT FOUND OR parent.owner_id <> NEW.owner_id OR parent.root_id <> NEW.root_id
        OR parent.depth + 1 <> NEW.depth OR parent.status <> 'completed'
        OR parent.recipient_job_id <> NEW.producer_job_id
        OR parent.result->>'revision' <> NEW.producer_revision THEN
        RAISE EXCEPTION 'Invalid handoff parent or producing result';
      END IF;
      -- Counts survive deleted descendants and serialize competing producers.
      UPDATE assistant_handoff_chains SET receipt_count = receipt_count + 1
        WHERE id = NEW.root_id AND owner_id = NEW.owner_id AND receipt_count < 20;
      IF NOT FOUND THEN RAISE EXCEPTION 'Handoff chain is full'; END IF;
    END IF;
    FOR source IN SELECT value FROM jsonb_array_elements(NEW.sources) LOOP
      IF jsonb_typeof(source) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(source)) <> 3
        OR NOT coalesce(source->>'kind' IN ('job','task','routine','goal','doc'),false)
        OR NOT coalesce(source->>'id' ~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$',false)
        OR jsonb_typeof(source->'revision') IS DISTINCT FROM 'string'
        OR NOT coalesce(length(btrim(source->>'revision')) BETWEEN 1 AND 128,false) THEN
        RAISE EXCEPTION 'Invalid handoff source reference';
      END IF;
    END LOOP;
    IF (SELECT count(DISTINCT (value->>'kind',value->>'id')) FROM jsonb_array_elements(NEW.sources))
      <> jsonb_array_length(NEW.sources) OR NOT NEW.sources @> jsonb_build_array(
        jsonb_build_object('kind','job','id',NEW.producer_job_id::text,'revision',NEW.producer_revision)) THEN
      RAISE EXCEPTION 'Missing producing revision or duplicate source';
    END IF;
    SELECT * INTO producer FROM ai_jobs WHERE id = NEW.producer_job_id FOR SHARE;
    IF NOT FOUND OR producer.user_id <> NEW.owner_id OR producer.runtime_lane <> NEW.producer_lane
      OR producer.state <> 'done' THEN
      RAISE EXCEPTION 'A handoff requires completed work from its owner and producing runtime';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.owner_id,NEW.root_id,NEW.parent_id,NEW.depth,NEW.producer_lane,
      NEW.recipient_lane,NEW.producer_job_id,NEW.producer_revision,NEW.title,NEW.instruction,NEW.sources,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.root_id,OLD.parent_id,OLD.depth,OLD.producer_lane,
      OLD.recipient_lane,OLD.producer_job_id,OLD.producer_revision,OLD.title,OLD.instruction,OLD.sources,OLD.created_at) THEN
      RAISE EXCEPTION 'Handoff provenance cannot change';
    END IF;
    IF OLD.status IN ('completed','failed','cancelled') OR NEW.revision <> OLD.revision + 1
      OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'Invalid handoff revision or terminal change';
    END IF;
    IF OLD.recipient_job_id IS NOT NULL AND NEW.recipient_job_id IS DISTINCT FROM OLD.recipient_job_id THEN
      RAISE EXCEPTION 'Receiving work cannot change';
    END IF;
    IF NEW.status = OLD.status THEN
      IF OLD.status <> 'proposed' OR NEW.delivery_attempts <> OLD.delivery_attempts + 1 THEN
        RAISE EXCEPTION 'Only a proposed delivery attempt can retain its status';
      END IF;
    ELSE
      IF NEW.delivery_attempts <> OLD.delivery_attempts OR NOT (
        (OLD.status = 'proposed' AND NEW.status IN ('accepted','failed','cancelled')) OR
        (OLD.status = 'accepted' AND NEW.status IN ('completed','failed','cancelled'))) THEN
        RAISE EXCEPTION 'Invalid handoff status transition';
      END IF;
    END IF;
    IF NEW.recipient_job_id IS DISTINCT FROM OLD.recipient_job_id THEN
      IF OLD.status <> 'proposed' OR NEW.status <> 'accepted' THEN
        RAISE EXCEPTION 'Receiving work is assigned only on acceptance';
      END IF;
      SELECT * INTO recipient FROM ai_jobs WHERE id = NEW.recipient_job_id FOR SHARE;
      IF NOT FOUND OR recipient.user_id <> NEW.owner_id OR recipient.runtime_lane <> NEW.recipient_lane
        OR recipient.state <> 'queued' THEN
        RAISE EXCEPTION 'Receiving work must be a distinct queued job in its owner runtime';
      END IF;
    END IF;
    IF NEW.status = 'completed' THEN
      IF jsonb_typeof(NEW.result) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(NEW.result)) <> 3 THEN
        RAISE EXCEPTION 'Invalid handoff result reference';
      END IF;
      SELECT * INTO recipient FROM ai_jobs WHERE id = NEW.recipient_job_id FOR SHARE;
      IF NOT FOUND OR recipient.state <> 'done' THEN
        RAISE EXCEPTION 'Only completed receiving work can be acknowledged';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_handoffs_guard BEFORE INSERT OR UPDATE ON assistant_handoffs
  FOR EACH ROW EXECUTE FUNCTION guard_assistant_handoff();
