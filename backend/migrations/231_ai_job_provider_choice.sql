ALTER TABLE ai_jobs ADD COLUMN provider_choice_snapshot jsonb
CHECK(provider_choice_snapshot IS NULL OR jsonb_typeof(provider_choice_snapshot)='object');
-- Earlier production had only the managed default. Explicitly configured beta
-- accounts have no recoverable enqueue-time evidence and stay fail-closed.
UPDATE ai_jobs SET provider_choice_snapshot='{"primary":"default","connection_id":null,"executor_id":null,"fallback_to_default":false,"version":0}'::jsonb
WHERE NOT EXISTS(SELECT 1 FROM user_ai_provider_choice p WHERE p.user_id=ai_jobs.user_id);

CREATE FUNCTION capture_ai_job_provider_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT jsonb_build_object('primary',p.primary_provider,'connection_id',p.connection_id,
   'executor_id',p.executor_id,'fallback_to_default',p.fallback_to_default,'version',p.version)
 INTO NEW.provider_choice_snapshot FROM user_ai_provider_choice p WHERE p.user_id=NEW.user_id;
 NEW.provider_choice_snapshot:=coalesce(NEW.provider_choice_snapshot,
   '{"primary":"default","connection_id":null,"executor_id":null,"fallback_to_default":false,"version":0}'::jsonb);
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_jobs_capture_provider_choice BEFORE INSERT ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION capture_ai_job_provider_choice();

CREATE FUNCTION immutable_ai_job_provider_choice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.provider_choice_snapshot IS DISTINCT FROM OLD.provider_choice_snapshot THEN
  RAISE EXCEPTION 'The enqueue-time AI provider choice is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_jobs_immutable_provider_choice BEFORE UPDATE OF provider_choice_snapshot ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION immutable_ai_job_provider_choice();
