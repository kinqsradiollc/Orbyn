-- Credential-free generations fence selection changes, including A -> B -> A.
ALTER TABLE ai_settings ADD COLUMN generation_revision bigint NOT NULL DEFAULT 1 CHECK(generation_revision>0);
ALTER TABLE ai_providers ADD COLUMN generation_revision bigint NOT NULL DEFAULT 1 CHECK(generation_revision>0);
CREATE FUNCTION advance_managed_selection_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.provider_id IS DISTINCT FROM OLD.provider_id OR NEW.model IS DISTINCT FROM OLD.model THEN
  NEW.generation_revision:=OLD.generation_revision+1;
 ELSE
  NEW.generation_revision:=OLD.generation_revision;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_settings_generation_revision BEFORE UPDATE ON ai_settings
FOR EACH ROW EXECUTE FUNCTION advance_managed_selection_revision();
CREATE FUNCTION advance_managed_provider_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.kind,NEW.base_url,NEW.api_key_encrypted,NEW.options,NEW.enabled)
 IS DISTINCT FROM ROW(OLD.kind,OLD.base_url,OLD.api_key_encrypted,OLD.options,OLD.enabled) THEN
  NEW.generation_revision:=OLD.generation_revision+1;
 ELSE
  NEW.generation_revision:=OLD.generation_revision;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_providers_generation_revision BEFORE UPDATE ON ai_providers
FOR EACH ROW EXECUTE FUNCTION advance_managed_provider_revision();

ALTER TABLE ai_jobs ADD COLUMN managed_provider_snapshot jsonb
CHECK(managed_provider_snapshot IS NULL OR jsonb_typeof(managed_provider_snapshot)='object');
-- Legacy rows remain NULL: current settings cannot prove their enqueue-time intent.
CREATE FUNCTION capture_managed_ai_job_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selection ai_settings%ROWTYPE; provider ai_providers%ROWTYPE;
BEGIN
 SELECT * INTO selection FROM ai_settings WHERE id FOR SHARE;
 NEW.managed_provider_snapshot:=jsonb_build_object('version',1,
  'selection_revision',coalesce(selection.generation_revision,0)::text,'provider',NULL);
 IF selection.provider_id IS NOT NULL AND selection.model<>'' THEN
  SELECT * INTO provider FROM ai_providers WHERE id=selection.provider_id FOR SHARE;
  IF provider.enabled THEN
   NEW.managed_provider_snapshot:=jsonb_set(NEW.managed_provider_snapshot,'{provider}',
    jsonb_build_object('id',provider.id,'revision',provider.generation_revision::text,'model',selection.model));
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_jobs_capture_managed_authority BEFORE INSERT ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION capture_managed_ai_job_authority();
CREATE FUNCTION immutable_managed_ai_job_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.managed_provider_snapshot IS DISTINCT FROM OLD.managed_provider_snapshot THEN
  RAISE EXCEPTION 'The enqueue-time managed AI authority is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_jobs_immutable_managed_authority BEFORE UPDATE OF managed_provider_snapshot ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION immutable_managed_ai_job_authority();
