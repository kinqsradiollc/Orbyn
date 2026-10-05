-- Independent, explicit owner consent. Read/write OAuth scopes never enable AI.
CREATE TABLE plugin_ai_permissions (
  grant_id uuid PRIMARY KEY REFERENCES agent_grants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  provider_id uuid,
  provider_revision text,
  provider_name varchar(80),
  model varchar(256),
  max_output_tokens integer NOT NULL DEFAULT 512 CHECK (max_output_tokens BETWEEN 1 AND 2048),
  daily_call_limit integer NOT NULL DEFAULT 10 CHECK (daily_call_limit BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (NOT enabled OR (provider_id IS NOT NULL AND provider_revision IS NOT NULL AND provider_name IS NOT NULL AND model IS NOT NULL)),
  CHECK (provider_revision IS NULL OR length(provider_revision) BETWEEN 1 AND 128)
);

-- Provider identity is a retained snapshot, not a cascading provider foreign key:
-- deleting a provider must not erase operation receipts and allow a duplicate call.
CREATE TABLE plugin_ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  permission_version integer NOT NULL CHECK (permission_version > 0),
  provider_id uuid NOT NULL,
  provider_revision text NOT NULL CHECK (length(provider_revision) BETWEEN 1 AND 128),
  model varchar(256) NOT NULL,
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 2048),
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 16000),
  prompt_digest text NOT NULL,
  token_hash text NOT NULL,
  reserved_day date NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed','unknown')),
  claim_token uuid,
  lease_until timestamptz,
  result text CHECK (result IS NULL OR octet_length(result) <= 65536),
  failure text CHECK (failure IS NULL OR length(failure) <= 256),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days'),
  UNIQUE (grant_id, operation_id),
  CHECK (state <> 'running' OR (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (state <> 'done' OR result IS NOT NULL)
);
CREATE INDEX plugin_ai_runs_allowance ON plugin_ai_runs(grant_id, reserved_day);
CREATE INDEX plugin_ai_runs_queue ON plugin_ai_runs(created_at, id) WHERE state='queued';
CREATE INDEX plugin_ai_runs_expired ON plugin_ai_runs(lease_until) WHERE state='running';
CREATE INDEX plugin_ai_runs_retention ON plugin_ai_runs(expires_at);
