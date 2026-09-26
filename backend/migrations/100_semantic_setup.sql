-- Search by meaning stays off by default. Turning it on is its own setup in
-- Admin, AI: it needs pgvector (not in the stock postgres:17-alpine image),
-- the measuring service (its own process, not the reminder loop), a model
-- that measures text, and an admin who has read and accepted that every
-- page is sent to the provider to be measured. Who accepted, and when, is
-- kept here. Safe to run again.

ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT '';
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS semantic_accepted_at timestamptz;
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS semantic_accepted_by uuid
  REFERENCES users(id) ON DELETE SET NULL;

-- Pages in a project kept out of the assistant are never measured: their
-- passages go when the switch is turned on (see the API), and none are
-- queued while it stays on.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RETURN;
  END IF;
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
END $$;
