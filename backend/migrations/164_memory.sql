-- Personal notes the named agent learns and outputs it creates.
-- Safe to run again.
CREATE INDEX IF NOT EXISTS docs_user_kind_idx ON docs (user_id, kind);

-- H8's About me page becomes the first memory note. Its pointer stays the
-- same, so existing Connected agents links and edits continue to work.
UPDATE docs d
   SET kind = 'memory', version = version + 1, updated_at = now()
  FROM agent_profiles p
 WHERE p.doc_id = d.id AND d.kind <> 'memory'
   AND d.team_id IS NULL AND d.project_id IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'docs_memory_personal_only'
       AND conrelid = 'docs'::regclass
  ) THEN
    ALTER TABLE docs ADD CONSTRAINT docs_memory_personal_only
      CHECK (kind <> 'memory' OR (team_id IS NULL AND project_id IS NULL)) NOT VALID;
  END IF;
END $$;

ALTER TABLE docs VALIDATE CONSTRAINT docs_memory_personal_only;

CREATE UNIQUE INDEX IF NOT EXISTS docs_one_memory_topic_idx
  ON docs (user_id, lower(title))
  WHERE kind = 'memory' AND deleted_at IS NULL AND title <> '';

CREATE TABLE IF NOT EXISTS memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES docs ON DELETE CASCADE,
  source_type text NOT NULL
    CHECK (source_type IN ('chat', 'doc', 'task', 'project', 'person')),
  source_id uuid,
  label text NOT NULL,
  quote text,
  learned_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_sources_doc_source_idx
  ON memory_sources (doc_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS memory_sources_doc_learned_idx
  ON memory_sources (doc_id, learned_at DESC);

-- Until general chats become durable in migration 165, this queue carries the
-- finished turns so learning never runs on the request path.
CREATE TABLE IF NOT EXISTS memory_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  turns jsonb NOT NULL,
  source_project_id uuid REFERENCES projects ON DELETE SET NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS memory_queue_pending_idx
  ON memory_queue (queued_at, id)
  WHERE claimed_at IS NULL;
