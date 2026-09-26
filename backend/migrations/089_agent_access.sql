-- Outside agents (MCP): connections, their credentials, what they did, and
-- the switches that limit them. Safe to run again.
--
-- A connection (agent_grants) is one person's permission for one agent:
-- an agent key made in Settings (kind 'key'), an OAuth sign-in (kind
-- 'oauth', phase A2), or an old personal API key used over MCP (kind
-- 'legacy', for 90 days). Every credential that leads to it is stored only
-- as a sha256 hash, like sessions.

-- Apps that sign in over OAuth (phase A2): a client id metadata document
-- (CIMD) URL or a registered id.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id            text PRIMARY KEY,
  kind          text NOT NULL DEFAULT 'cimd' CHECK (kind IN ('cimd', 'dcr')),
  name          text NOT NULL DEFAULT '',
  host          text NOT NULL DEFAULT '',
  redirect_uris text[] NOT NULL DEFAULT '{}',
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  etag          text,
  fetched_at    timestamptz,
  blocked       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE TABLE IF NOT EXISTS agent_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('oauth', 'key', 'legacy')),
  client_id     text,
  client_name   text NOT NULL DEFAULT '',
  -- A key's name ("MacBook · Codex CLI"); an app's name for OAuth.
  name          text NOT NULL DEFAULT '',
  access        text NOT NULL DEFAULT 'read'
                CHECK (access IN ('read', 'suggest', 'write')),
  -- Teams the agent sees; NULL means every team the person is in (legacy).
  team_ids      uuid[] DEFAULT '{}',
  personal      boolean NOT NULL DEFAULT true,
  toolsets      text[] NOT NULL DEFAULT '{core}',
  -- notify_teammates, hide_outside_content (both off unless chosen).
  flags         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The personal API key behind a legacy connection.
  api_key_id    uuid REFERENCES api_keys(id) ON DELETE CASCADE,
  expires_at    timestamptz,
  last_used_at  timestamptz,
  -- The last change it made: its reads go to the primary for a few seconds
  -- after, so it sees its own writes (read-your-writes).
  last_write_at timestamptz,
  suspended_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_grants_user_idx
  ON agent_grants (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agent_grants_api_key_idx
  ON agent_grants (api_key_id) WHERE api_key_id IS NOT NULL;

-- One-time OAuth codes (phase A2): 60 seconds, spent with DELETE…RETURNING.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      text PRIMARY KEY,
  grant_id       uuid NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
  client_id      text NOT NULL,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  resource       text NOT NULL,
  scope          text NOT NULL DEFAULT '',
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Credentials for a connection: access tokens (oat_), refresh tokens (ort_)
-- and agent keys (oak_), hashed.
CREATE TABLE IF NOT EXISTS agent_tokens (
  token_hash text PRIMARY KEY,
  grant_id   uuid NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('access', 'refresh', 'key')),
  prefix     text NOT NULL DEFAULT '',
  -- Refresh tokens that rotated from one another; reusing a spent one
  -- revokes the whole family.
  family     uuid,
  resource   text,
  expires_at timestamptz,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tokens_grant_idx ON agent_tokens (grant_id);

-- What agents did. Changes are one row each; reads are counted per minute.
-- `undo` keeps the before-values of structured fields (never page bodies,
-- which have versions) for 30 days.
CREATE TABLE IF NOT EXISTS agent_activity (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id    uuid REFERENCES agent_grants(id) ON DELETE CASCADE,
  client_name text NOT NULL DEFAULT '',
  tool        text NOT NULL,
  tier        text NOT NULL DEFAULT 'R',
  team_id     uuid,
  target_ids  text[] NOT NULL DEFAULT '{}',
  args_digest text,
  summary     text NOT NULL DEFAULT '',
  outcome     text NOT NULL CHECK (outcome IN
                ('ok', 'denied', 'error', 'proposed', 'suggested', 'confirmed', 'limited')),
  calls       integer NOT NULL DEFAULT 1,
  proposal_id uuid,
  request_id  text,
  latency_ms  integer,
  undo        jsonb,
  undo_until  timestamptz
);
CREATE INDEX IF NOT EXISTS agent_activity_grant_idx
  ON agent_activity (grant_id, at DESC);
CREATE INDEX IF NOT EXISTS agent_activity_user_idx
  ON agent_activity (user_id, at DESC);

-- Calls per connection per day, for quotas that hold across every copy of
-- the mcp service.
CREATE TABLE IF NOT EXISTS agent_usage_daily (
  day      date NOT NULL,
  grant_id uuid NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
  calls    integer NOT NULL DEFAULT 0,
  writes   integer NOT NULL DEFAULT 0,
  denied   integer NOT NULL DEFAULT 0,
  limited  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, grant_id)
);

-- Single-use seals (plan tokens, confirmation state) and idempotency
-- records for agent writes, bound to one connection.
CREATE TABLE IF NOT EXISTS mcp_request_state (
  id         text PRIMARY KEY,
  grant_id   uuid REFERENCES agent_grants(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  value      jsonb,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A team's cap on outside agents: follow each member's role, or cap at
-- suggest, read, or off.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS agent_access text NOT NULL DEFAULT 'role';
DO $$ BEGIN
  ALTER TABLE teams ADD CONSTRAINT teams_agent_access_check
    CHECK (agent_access IN ('role', 'suggest', 'read', 'off'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Which agent made a change, in a project's timeline and a page's history.
-- Filled from set_config('orbyn.agent_grant', …) by the triggers below, so
-- every write path that sets it is labelled without changing the activity
-- functions themselves.
ALTER TABLE project_activity ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
ALTER TABLE doc_versions ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION fill_via_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_id uuid := nullif(current_setting('orbyn.agent_grant', true), '')::uuid;
BEGIN
  IF NEW.via_grant_id IS NULL AND grant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM agent_grants g WHERE g.id = grant_id) THEN
    NEW.via_grant_id := grant_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_activity_via_grant ON project_activity;
CREATE TRIGGER project_activity_via_grant BEFORE INSERT ON project_activity
  FOR EACH ROW EXECUTE FUNCTION fill_via_grant();
DROP TRIGGER IF EXISTS doc_versions_via_grant ON doc_versions;
CREATE TRIGGER doc_versions_via_grant BEFORE INSERT ON doc_versions
  FOR EACH ROW EXECUTE FUNCTION fill_via_grant();

-- Audit entries can be joined to the request that made them.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id text;

-- Old personal API keys keep working over MCP for 90 days from this
-- release, then only over the REST API and CalDAV.
INSERT INTO system_settings (key, value, updated_at)
VALUES ('agents_legacy_keys_until',
        to_jsonb(to_char((now() + interval '90 days') AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        now())
ON CONFLICT (key) DO NOTHING;
