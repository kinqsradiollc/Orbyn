-- The person's chosen name and persona for Orbyn's built-in assistant.
-- Safe to run again.
CREATE TABLE IF NOT EXISTS agent_settings (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Orbyn'
    CHECK (length(name) BETWEEN 1 AND 40),
  persona text NOT NULL DEFAULT '' CHECK (length(persona) <= 1000),
  named_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
