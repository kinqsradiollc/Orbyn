-- Content-free execution events. Presence writes and polling never create activity.
CREATE TABLE assistant_activity_streams (
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  runtime_lane text NOT NULL CHECK (runtime_lane IN ('interactive','background','overnight')),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  PRIMARY KEY(owner_id,runtime_lane)
);
CREATE TABLE assistant_activity_events (
  owner_id uuid NOT NULL,
  runtime_lane text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  job_id uuid REFERENCES ai_jobs ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('queued','running','waiting','done','failed','progress','outcome')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_id,runtime_lane,sequence),
  FOREIGN KEY(owner_id,runtime_lane) REFERENCES assistant_activity_streams ON DELETE CASCADE
);
CREATE INDEX assistant_activity_job ON assistant_activity_events(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX assistant_activity_retention ON assistant_activity_events(created_at);

CREATE FUNCTION record_assistant_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind text; next_sequence bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Do not invent completion/activity times for imported historical rows.
    IF NEW.state <> 'queued' THEN RETURN NEW; END IF;
    event_kind := 'queued';
  ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
    event_kind := NEW.state;
  ELSIF NEW.state = 'running' AND NEW.progress IS DISTINCT FROM OLD.progress THEN
    event_kind := 'progress';
  ELSIF NEW.state IN ('done','failed') AND (
    NEW.result IS DISTINCT FROM OLD.result OR NEW.apply_result IS DISTINCT FROM OLD.apply_result) THEN
    event_kind := 'outcome';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO assistant_activity_streams(owner_id,runtime_lane,last_sequence)
    VALUES(NEW.user_id,NEW.runtime_lane,1)
    ON CONFLICT(owner_id,runtime_lane) DO UPDATE
    SET last_sequence=assistant_activity_streams.last_sequence+1
    RETURNING last_sequence INTO next_sequence;
  INSERT INTO assistant_activity_events(owner_id,runtime_lane,sequence,job_id,kind)
    VALUES(NEW.user_id,NEW.runtime_lane,next_sequence,NEW.id,event_kind);
  RETURN NEW;
END
$$;
CREATE TRIGGER assistant_job_activity AFTER INSERT OR UPDATE ON ai_jobs
  FOR EACH ROW EXECUTE FUNCTION record_assistant_activity();
