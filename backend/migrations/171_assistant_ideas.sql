-- Daily ideas are proposals backed by the normal Review inbox.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'change';
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_kind_check CHECK (kind IN ('change', 'idea'));

CREATE TABLE IF NOT EXISTS assistant_idea_days (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (user_id, local_day)
);

CREATE TABLE IF NOT EXISTS assistant_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  proposal_id uuid REFERENCES proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_ideas_recent_idx
  ON assistant_ideas (user_id, local_day DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS assistant_ideas_user_day_idx
  ON assistant_ideas (user_id, local_day);
