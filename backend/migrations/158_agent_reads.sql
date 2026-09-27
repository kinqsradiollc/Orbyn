-- Agent 2 (H2): the agent reads, Orbyn keeps the result. Safe to run again.
--
-- 1. Long pages sent in parts (append_doc): a draft holds the parts until
--    the agent finishes it, then becomes the page (all or nothing). An
--    unfinished draft goes 24 hours after its last part (lib/sweep.ts).
-- 2. Sources an agent read (save_source): the address, title, quote, day
--    read and author, saved once per space (personal or a team) and linked
--    to the pages (and lines) that use them. Orbyn never fetches them.
-- 3. Files an agent sends (add_file): counted per person per day, and page
--    files say they came from an agent.

CREATE TABLE IF NOT EXISTS agent_doc_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  -- The connection that started it: only it may add parts or finish it.
  grant_id uuid REFERENCES agent_grants ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  -- Where the page goes: kind, team_id, folder_id, project_id, item_id.
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Once finished: the answer it gave (the pages made), so sending finish
  -- again answers the same instead of making the pages twice.
  done jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS agent_doc_drafts_user_idx
  ON agent_doc_drafts (user_id, grant_id);
CREATE INDEX IF NOT EXISTS agent_doc_drafts_expires_idx
  ON agent_doc_drafts (expires_at);

CREATE TABLE IF NOT EXISTS agent_doc_draft_parts (
  draft_id uuid NOT NULL REFERENCES agent_doc_drafts ON DELETE CASCADE,
  n integer NOT NULL CHECK (n BETWEEN 1 AND 200),
  markdown text NOT NULL,
  bytes integer NOT NULL CHECK (bytes >= 0),
  PRIMARY KEY (draft_id, n)
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who saved it (through which connection), and the space it is in.
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  grant_id uuid REFERENCES agent_grants ON DELETE SET NULL,
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  site text NOT NULL DEFAULT '' CHECK (char_length(site) <= 200),
  author text CHECK (author IS NULL OR char_length(author) <= 200),
  quote text CHECK (quote IS NULL OR char_length(quote) <= 2000),
  accessed_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One source per address per space.
CREATE UNIQUE INDEX IF NOT EXISTS sources_personal_url
  ON sources (user_id, url) WHERE team_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sources_team_url
  ON sources (team_id, url) WHERE team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS source_uses (
  source_id uuid NOT NULL REFERENCES sources ON DELETE CASCADE,
  doc_id uuid NOT NULL REFERENCES docs ON DELETE CASCADE,
  -- The line that uses it ('' for the page as a whole).
  block_id text NOT NULL DEFAULT '' CHECK (char_length(block_id) <= 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, doc_id, block_id)
);
CREATE INDEX IF NOT EXISTS source_uses_doc_idx ON source_uses (doc_id);

-- What each person's agents sent in files, per day, for the daily cap.
CREATE TABLE IF NOT EXISTS agent_file_days (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  day date NOT NULL,
  bytes bigint NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  PRIMARY KEY (user_id, day)
);

-- A page file an agent sent.
ALTER TABLE page_files DROP CONSTRAINT IF EXISTS page_files_source_check;
ALTER TABLE page_files ADD CONSTRAINT page_files_source_check
  CHECK (source IN ('upload', 'import', 'agent'));
