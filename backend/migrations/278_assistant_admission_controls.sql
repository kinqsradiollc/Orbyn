ALTER TABLE agent_settings ADD COLUMN background_paused boolean NOT NULL DEFAULT false;
ALTER TABLE agent_settings ADD COLUMN overnight_paused boolean NOT NULL DEFAULT false;

-- Admission-only: existing jobs may resume, stop and complete without consulting
-- these flags. Grant suspension/revocation remains a separate authority boundary.
CREATE OR REPLACE FUNCTION guard_assistant_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lane text; paused boolean;
BEGIN
  IF TG_TABLE_NAME='ai_jobs' THEN
    -- Retaining a finished foreground turn queues its existing Memory/sweep
    -- maintenance authority. That continuation must not roll back chat storage.
    IF NEW.run_state->>'version'='6' THEN RETURN NEW; END IF;
    lane := assistant_runtime_lane(NEW.run_state);
  ELSIF TG_TABLE_NAME='assistant_page_runs' THEN lane := NEW.lane;
  ELSE lane := 'overnight'; END IF;
  IF lane='interactive' THEN RETURN NEW; END IF;
  SELECT CASE WHEN lane='overnight' THEN a.overnight_paused ELSE a.background_paused END
    INTO paused FROM agent_settings a WHERE a.user_id=NEW.user_id FOR SHARE;
  IF coalesce(paused,false) THEN
    RAISE EXCEPTION 'New % work is paused',lane USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assistant_admission_guard BEFORE INSERT ON ai_jobs FOR EACH ROW EXECUTE FUNCTION guard_assistant_admission();
CREATE TRIGGER assistant_page_admission_guard BEFORE INSERT ON assistant_page_runs FOR EACH ROW EXECUTE FUNCTION guard_assistant_admission();
CREATE TRIGGER assistant_night_admission_guard BEFORE INSERT ON assistant_nights FOR EACH ROW EXECUTE FUNCTION guard_assistant_admission();
