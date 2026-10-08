-- Maintenance uses the same captured owner/provider authority as other AI jobs.
ALTER TABLE memory_queue ADD COLUMN maintenance_job_id uuid REFERENCES ai_jobs ON DELETE SET NULL;
ALTER TABLE ai_chats ADD COLUMN sweep_job_id uuid REFERENCES ai_jobs ON DELETE SET NULL;

CREATE FUNCTION chat_maintenance_source_digest(source ai_chats) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT md5(jsonb_build_array(source.turns,source.title,source.project_id,
   source.scope_kind,source.scope_id,source.origin,extract(epoch FROM source.last_used_at))::text)
$$;

-- A later appended turn does not revoke earlier personal facts; edits/removals do.
CREATE FUNCTION chat_maintenance_memory_digest(source ai_chats,turn_count integer) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT md5(jsonb_build_array(coalesce((SELECT jsonb_agg(value ORDER BY position)
   FROM jsonb_array_elements(source.turns) WITH ORDINALITY AS saved(value,position)
   WHERE position<=turn_count),'[]'::jsonb),source.project_id,
   source.scope_kind,source.scope_id,source.origin)::text)
$$;

-- These jobs belong to housekeeping, not to the interactive assistant runtime.
CREATE OR REPLACE FUNCTION assistant_runtime_lane(checkpoint jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
  WHEN checkpoint->>'version'='6' THEN 'background'
  WHEN checkpoint->'request'->'automation'->>'kind'='night'
    OR nullif(checkpoint->'request'->'automation'->>'night_id','') IS NOT NULL THEN 'overnight'
  WHEN nullif(checkpoint->'request'->'automation','null'::jsonb) IS NOT NULL THEN 'background'
  ELSE 'interactive' END
$$;

CREATE FUNCTION capture_memory_maintenance_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source ai_chats%ROWTYPE; preference jsonb;
BEGIN
 SELECT * INTO source FROM ai_chats WHERE id=NEW.chat_id AND user_id=NEW.user_id;
 -- Automated/unknown legacy sources have no personal-memory authority.
 NEW.maintenance_job_id:=NULL;
 IF source.id IS NULL OR source.origin<>'person' THEN RETURN NEW; END IF;
 SELECT jsonb_build_object('connection_id',p.connection_id,'model',p.model,'version',p.version)
 INTO preference FROM chatgpt_model_preferences p JOIN user_ai_provider_choice choice
 ON choice.connection_id=p.connection_id WHERE choice.user_id=NEW.user_id AND choice.primary_provider='chatgpt' FOR SHARE OF p;
 INSERT INTO ai_jobs(user_id,state,run_state)
 VALUES(NEW.user_id,'queued',jsonb_build_object('version',6,'maintenance','memory',
  'chat_id',NEW.chat_id,'queue_id',NEW.id,'source_turn_count',jsonb_array_length(source.turns),
  'source_digest',chat_maintenance_memory_digest(source,jsonb_array_length(source.turns)),
  'input_digest',md5(NEW.turns::text),'source_project_id',NEW.source_project_id,'preference',preference))
 RETURNING id INTO NEW.maintenance_job_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER memory_queue_capture_provider BEFORE INSERT ON memory_queue
FOR EACH ROW EXECUTE FUNCTION capture_memory_maintenance_job();

CREATE FUNCTION cancel_deleted_memory_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE ai_jobs SET state='failed',lease_until=NULL,claimed_by=NULL,error_message='The memory source was removed.'
 WHERE id=OLD.maintenance_job_id AND user_id=OLD.user_id AND state IN ('queued','running','waiting');
 RETURN OLD;
END;
$$;
CREATE TRIGGER memory_queue_cancel_maintenance AFTER DELETE ON memory_queue
FOR EACH ROW EXECUTE FUNCTION cancel_deleted_memory_maintenance();
-- Existing rows remain unverified. Current configuration cannot prove their
-- earlier recipient; a fresh personal turn creates a new captured job.
