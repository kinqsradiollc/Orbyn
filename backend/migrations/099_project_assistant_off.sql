-- Keep a project out of the assistant: owners and admins (the owner, for a
-- personal project) can switch it off. The assistant, Study, the morning
-- agenda, search by meaning and connected agents then never read the
-- project, its tasks, pages or records, not even their titles.
-- Saved project chats: a person's own conversations with the assistant
-- about one project, kept so they can be picked up again. Never shared.
-- Safe to run again.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS assistant_off boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS projects_assistant_off ON projects (id) WHERE assistant_off;

CREATE TABLE IF NOT EXISTS project_chats (
  -- Made by the app, so saving again after each reply updates one chat.
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- [{ role: 'user' | 'assistant', text, sources? }], at most 40 turns.
  turns       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_chats_mine
  ON project_chats (user_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS project_chats_stale ON project_chats (updated_at);
