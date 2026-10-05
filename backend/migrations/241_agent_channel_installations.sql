-- OAuth callbacks can capture a pending encrypted installation, never silently
-- link an Orbyn account. Confirmation requires the exact initiating app session.
CREATE TABLE agent_channel_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider='slack'),
  app_id text NOT NULL,
  workspace_id text NOT NULL,
  workspace_name text NOT NULL,
  external_user_id text NOT NULL,
  bot_user_id text NOT NULL,
  scopes text[] NOT NULL,
  credentials_encrypted text,
  token_expires_at timestamptz,
  dm_enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  disconnected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,provider),
  CHECK(NOT dm_enabled OR (disconnected_at IS NULL AND credentials_encrypted IS NOT NULL)),
  CHECK(disconnected_at IS NULL OR (NOT dm_enabled AND credentials_encrypted IS NULL))
);
CREATE UNIQUE INDEX agent_channel_live_actor ON agent_channel_installations
 (provider,app_id,workspace_id,external_user_id) WHERE disconnected_at IS NULL;

CREATE TABLE agent_channel_oauth_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE CHECK(length(state_hash)=64),
  config_hash text NOT NULL CHECK(length(config_hash)=64),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','exchanging','ready','done','failed')),
  exchange_claim uuid,
  installation_encrypted text,
  connection_id uuid REFERENCES agent_channel_installations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  CHECK((state='exchanging')=(exchange_claim IS NOT NULL)),
  CHECK((state='ready')=(installation_encrypted IS NOT NULL))
);
CREATE INDEX agent_channel_pending_owner ON agent_channel_oauth_pending(user_id,expires_at);
