ALTER TABLE memory_queue ADD COLUMN source_entry_ids uuid[];
-- Only newly learned, completely retained sources can replace the conservative
-- legacy whole-chat boundary. Existing facts are never silently promoted.
ALTER TABLE memory_sources ADD COLUMN retained_entries boolean NOT NULL DEFAULT false;

CREATE FUNCTION chat_maintenance_entry_digest(source ai_chats,entry_ids uuid[]) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN cardinality(entry_ids)>0 AND (
   SELECT count(*) FROM assistant_conversation_entries e JOIN assistant_conversation_streams s ON s.id=e.destination_id
   WHERE e.id=ANY(entry_ids) AND s.chat_id=source.id AND s.owner_id=source.user_id AND s.retired_at IS NULL
 )=cardinality(entry_ids) THEN md5(jsonb_build_array(
   (SELECT jsonb_agg(jsonb_build_array(e.id,e.payload) ORDER BY e.id)
    FROM assistant_conversation_entries e WHERE e.id=ANY(entry_ids)),
   source.project_id,source.scope_kind,source.scope_id,source.origin)::text) END
$$;

CREATE OR REPLACE FUNCTION capture_memory_maintenance_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source ai_chats%ROWTYPE; preference jsonb; digest text;
BEGIN
 SELECT * INTO source FROM ai_chats WHERE id=NEW.chat_id AND user_id=NEW.user_id;
 NEW.maintenance_job_id:=NULL;
 IF source.id IS NULL OR source.origin<>'person' THEN RETURN NEW; END IF;
 IF NEW.source_entry_ids IS NOT NULL THEN
   digest:=chat_maintenance_entry_digest(source,NEW.source_entry_ids);
   IF digest IS NULL THEN RAISE EXCEPTION 'Retained Memory source is unavailable'; END IF;
 ELSE
   digest:=chat_maintenance_memory_digest(source,jsonb_array_length(source.turns));
 END IF;
 SELECT jsonb_build_object('connection_id',p.connection_id,'model',p.model,'version',p.version)
 INTO preference FROM chatgpt_model_preferences p JOIN user_ai_provider_choice choice
 ON choice.connection_id=p.connection_id WHERE choice.user_id=NEW.user_id AND choice.primary_provider='chatgpt' FOR SHARE OF p;
 INSERT INTO ai_jobs(user_id,state,run_state)
 VALUES(NEW.user_id,'queued',jsonb_strip_nulls(jsonb_build_object('version',6,'maintenance','memory',
  'chat_id',NEW.chat_id,'queue_id',NEW.id,'source_turn_count',jsonb_array_length(source.turns),
  'source_entry_ids',NEW.source_entry_ids,
  'source_digest',digest,'input_digest',md5(NEW.turns::text),'source_project_id',NEW.source_project_id))
  || jsonb_build_object('preference',preference,'source_project_id',NEW.source_project_id))
 RETURNING id INTO NEW.maintenance_job_id;
 RETURN NEW;
END;
$$;
