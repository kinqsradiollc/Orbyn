-- Generation-only request controls do not change an embedding connection.
-- Keep existing acceptance tokens; this does not revive previously invalidated consent.
CREATE OR REPLACE FUNCTION bump_embedding_provider_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.kind, NEW.name, NEW.base_url, NEW.api_key_encrypted,
         NEW.key_hint, NEW.enabled,
         coalesce(NEW.options, '{}'::jsonb) - ARRAY['reasoningEffort','cacheMode','cacheRetention'])
     IS DISTINCT FROM
     ROW(OLD.kind, OLD.name, OLD.base_url, OLD.api_key_encrypted,
         OLD.key_hint, OLD.enabled,
         coalesce(OLD.options, '{}'::jsonb) - ARRAY['reasoningEffort','cacheMode','cacheRetention']) THEN
    NEW.embedding_revision := OLD.embedding_revision + 1;
  ELSE
    NEW.embedding_revision := OLD.embedding_revision;
  END IF;
  RETURN NEW;
END $$;
