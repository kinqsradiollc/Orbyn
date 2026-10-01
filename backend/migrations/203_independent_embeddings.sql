-- Independent embedding consent must survive mixed-version deployment safely:
-- old workers read semantic_search and therefore remain disabled.
ALTER TABLE ai_providers ADD COLUMN embedding_revision bigint NOT NULL DEFAULT 1;
CREATE FUNCTION bump_embedding_provider_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.embedding_revision := OLD.embedding_revision + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER embedding_provider_revision
  BEFORE UPDATE ON ai_providers
  FOR EACH ROW EXECUTE FUNCTION bump_embedding_provider_revision();

ALTER TABLE ai_settings
  ADD COLUMN embedding_search_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN embedding_provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  ADD COLUMN embedding_provider_revision bigint,
  ADD COLUMN embedding_dimensions integer CHECK (embedding_dimensions BETWEEN 1 AND 16000),
  ADD COLUMN embedding_generation uuid NOT NULL DEFAULT gen_random_uuid();
-- Legacy acceptance did not identify the recipient or vector dimensions.
UPDATE ai_settings SET semantic_search = false,
  semantic_accepted_at = NULL, semantic_accepted_by = NULL;
ALTER TABLE ai_settings ADD CONSTRAINT legacy_semantic_worker_disabled
  CHECK (semantic_search = false);

CREATE OR REPLACE FUNCTION ensure_vectors() RETURNS boolean
LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RETURN false;
  END IF;

  CREATE TABLE IF NOT EXISTS doc_embeddings (
    doc_id uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    block_id text NOT NULL,
    quote text NOT NULL,
    embedding vector NOT NULL,
    model text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, block_id)
  );
  -- Exact cosine search supports all verified storage dimensions. An ANN
  -- strategy can be selected explicitly later, never by truncating vectors.
  DROP INDEX IF EXISTS doc_embeddings_vector_idx;
  IF EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid = 'doc_embeddings'::regclass AND attname = 'embedding'
      AND atttypmod <> -1) THEN
    ALTER TABLE doc_embeddings ALTER COLUMN embedding TYPE vector;
  END IF;
  ALTER TABLE doc_embeddings ADD COLUMN IF NOT EXISTS embedding_generation uuid;
  ALTER TABLE doc_embeddings ADD COLUMN IF NOT EXISTS doc_version integer;
  -- Unproven legacy provenance cannot answer under a new configuration.
  DELETE FROM doc_embeddings WHERE embedding_generation IS NULL OR doc_version IS NULL;

  CREATE TABLE IF NOT EXISTS doc_embedding_queue (
    doc_id uuid PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
    queued_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE doc_embedding_queue ADD COLUMN IF NOT EXISTS queue_revision uuid
    NOT NULL DEFAULT gen_random_uuid();

  CREATE OR REPLACE FUNCTION docs_embedding_queue_touch() RETURNS trigger
  LANGUAGE plpgsql AS $t$
  BEGIN
    IF NEW.deleted_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.assistant_off
    ) THEN
      DELETE FROM doc_embeddings WHERE doc_id = NEW.id;
      DELETE FROM doc_embedding_queue WHERE doc_id = NEW.id;
      RETURN NULL;
    END IF;
    INSERT INTO doc_embedding_queue (doc_id) VALUES (NEW.id)
      ON CONFLICT (doc_id) DO UPDATE SET queued_at = now(),
        queue_revision = gen_random_uuid();
    RETURN NULL;
  END $t$;
  DROP TRIGGER IF EXISTS docs_embedding_trigger ON docs;
  CREATE TRIGGER docs_embedding_trigger
    AFTER INSERT OR UPDATE OF content, version, deleted_at, project_id, team_id ON docs
    FOR EACH ROW EXECUTE FUNCTION docs_embedding_queue_touch();
  RETURN true;
END $fn$;

SELECT ensure_vectors();
