-- Search by meaning, set up whenever pgvector becomes available.
--
-- Migrations run once by name, so on a deployment that started on the stock
-- postgres image 041 ran as a no-op and 100 never replaced its trigger:
-- swapping the image later changed nothing. This keeps the whole vector
-- setup in one function, ensure_vectors(), which the migrate step calls on
-- every run (see backend/src/db/migrate.ts). It is safe to call any number of
-- times: without pgvector it does nothing; with it, it creates the tables,
-- the index and the keep-out-aware queue trigger, and queues every page that
-- may be measured the first time the tables appear.

CREATE OR REPLACE FUNCTION ensure_vectors() RETURNS boolean
LANGUAGE plpgsql AS $fn$
DECLARE
  fresh boolean;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RETURN false;
  END IF;

  fresh := to_regclass('doc_embeddings') IS NULL;

  CREATE TABLE IF NOT EXISTS doc_embeddings (
    doc_id     uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
    block_id   text NOT NULL,
    quote      text NOT NULL,
    embedding  vector(1536) NOT NULL,
    model      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (doc_id, block_id)
  );
  CREATE INDEX IF NOT EXISTS doc_embeddings_vector_idx
    ON doc_embeddings USING hnsw (embedding vector_cosine_ops);
  CREATE TABLE IF NOT EXISTS doc_embedding_queue (
    doc_id     uuid PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
    queued_at  timestamptz NOT NULL DEFAULT now()
  );

  -- Pages in a project kept out of the assistant are never queued.
  CREATE OR REPLACE FUNCTION docs_embedding_queue_touch() RETURNS trigger
  LANGUAGE plpgsql AS $t$
  BEGIN
    IF NEW.project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = NEW.project_id AND p.assistant_off) THEN
      RETURN NULL;
    END IF;
    INSERT INTO doc_embedding_queue (doc_id) VALUES (NEW.id)
      ON CONFLICT (doc_id) DO UPDATE SET queued_at = now();
    RETURN NULL;
  END $t$;

  DROP TRIGGER IF EXISTS docs_embedding_trigger ON docs;
  CREATE TRIGGER docs_embedding_trigger
    AFTER INSERT OR UPDATE OF content ON docs
    FOR EACH ROW EXECUTE FUNCTION docs_embedding_queue_touch();

  -- Kept-out pages must never have passages, whenever the tables appeared.
  DELETE FROM doc_embeddings e USING docs d, projects p
   WHERE e.doc_id = d.id AND d.project_id = p.id AND p.assistant_off;
  DELETE FROM doc_embedding_queue q USING docs d, projects p
   WHERE q.doc_id = d.id AND d.project_id = p.id AND p.assistant_off;

  IF fresh THEN
    INSERT INTO doc_embedding_queue (doc_id)
      SELECT d.id FROM docs d
       WHERE d.project_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM projects p
                          WHERE p.id = d.project_id AND p.assistant_off)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN true;
END $fn$;

SELECT ensure_vectors();
