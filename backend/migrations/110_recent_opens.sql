-- The quick switcher's recent list (NAV-02): the pages, tasks and projects a
-- person opened last, on any device. One row per thing, moved to the top
-- when opened again; only the latest 50 are kept per person, and the
-- sweeper clears rows untouched for 90 days. Safe to run again.
CREATE TABLE IF NOT EXISTS recent_opens (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('doc', 'task', 'project')),
  target_id uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, target_id)
);
CREATE INDEX IF NOT EXISTS recent_opens_user_idx
  ON recent_opens (user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS recent_opens_time_idx ON recent_opens (opened_at);

-- Finding a project by name from its first letter, as pages and tasks are.
CREATE INDEX IF NOT EXISTS projects_name_trgm_idx
  ON projects USING gin (name gin_trgm_ops);
