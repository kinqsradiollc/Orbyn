-- Semantic search: finding a page that says the thing in other words.
--
-- This needs pgvector, which the stock postgres image does not ship. Rather
-- than make the whole deployment depend on swapping that image, everything
-- here is conditional: on an image without the extension the migration is a
-- no-op and semantic search simply stays off, with the word search from
-- migration 040 doing all the work as before. Swapping the image later and
-- re-running migrations turns it on; nothing else has to change.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector is not available here; semantic search stays off.';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RETURN;
  END IF;

  -- One row per line of a page, so a hit can say which line said it, the
  -- same way the word search does.
  CREATE TABLE IF NOT EXISTS doc_embeddings (
    doc_id     uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    block_id   text NOT NULL,
    -- What the line said when it was measured; a line whose words have
    -- changed is measured again rather than answering for the old ones.
    quote      text NOT NULL,
    embedding  vector(1536) NOT NULL,
    model      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, block_id)
  );

  CREATE INDEX IF NOT EXISTS doc_embeddings_vector_idx
    ON doc_embeddings USING hnsw (embedding vector_cosine_ops);

  -- Pages whose lines have changed since they were measured. The worker
  -- reads this rather than walking every page.
  CREATE TABLE IF NOT EXISTS doc_embedding_queue (
    doc_id     uuid PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
    queued_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE OR REPLACE FUNCTION docs_embedding_queue_touch() RETURNS trigger
  LANGUAGE plpgsql AS $t$
  BEGIN
    INSERT INTO doc_embedding_queue (doc_id) VALUES (NEW.id)
      ON CONFLICT (doc_id) DO UPDATE SET queued_at = now();
    RETURN NULL;
  END $t$;

  DROP TRIGGER IF EXISTS docs_embedding_trigger ON docs;
  CREATE TRIGGER docs_embedding_trigger
    AFTER INSERT OR UPDATE OF content ON docs
    FOR EACH ROW EXECUTE FUNCTION docs_embedding_queue_touch();

  -- Everything already written is measured once, when the worker next runs.
  INSERT INTO doc_embedding_queue (doc_id) SELECT id FROM docs
    ON CONFLICT DO NOTHING;
END $$;

-- Whether semantic search is wanted at all. Off by default: measuring a page
-- means sending its words to whichever provider is configured, and that is a
-- decision for whoever runs the workspace, not a default.
ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS semantic_search boolean NOT NULL DEFAULT false;
