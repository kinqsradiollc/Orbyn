-- Every assistant conversation has one durable, private chat row.
-- Keep project_chats until the next release so older clients can still read it.
-- Safe to run again.

CREATE TABLE IF NOT EXISTS ai_chats (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  pinned boolean NOT NULL DEFAULT false,
  turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary_doc_id uuid REFERENCES docs(id) ON DELETE SET NULL,
  swept_at timestamptz,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scope_kind text CHECK (scope_kind IN ('project', 'task')),
  scope_id uuid,
  CHECK ((scope_kind IS NULL) = (scope_id IS NULL))
);

CREATE INDEX IF NOT EXISTS ai_chats_user_recent_idx
  ON ai_chats (user_id, pinned DESC, last_used_at DESC);
CREATE INDEX IF NOT EXISTS ai_chats_project_recent_idx
  ON ai_chats (user_id, project_id, pinned DESC, last_used_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_chats_sweep_idx
  ON ai_chats (last_used_at)
  WHERE pinned = false AND swept_at IS NULL;

-- Preserve every existing project conversation and its original identity.
INSERT INTO ai_chats (
  id, user_id, project_id, title, turns, last_used_at, created_at,
  scope_kind, scope_id
)
SELECT id, user_id, project_id, title, turns,
       coalesce(updated_at, created_at, now()),
       coalesce(created_at, now()), 'project', project_id
  FROM project_chats
ON CONFLICT (id) DO NOTHING;

-- Existing queued rows use job ids. New rows use the durable ai_chats id;
-- the column intentionally has no FK so pre-M3 learning jobs remain processable.
