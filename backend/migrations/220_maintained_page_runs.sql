ALTER TABLE assistant_page_bindings ADD COLUMN schedule_exhausted boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX assistant_page_binding_identity ON assistant_page_bindings(id,user_id,agent_grant_id);
CREATE UNIQUE INDEX assistant_night_owner_identity ON assistant_nights(id,user_id);
CREATE TABLE assistant_page_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL,
  user_id uuid NOT NULL,
  agent_grant_id uuid NOT NULL,
  FOREIGN KEY(binding_id,user_id,agent_grant_id) REFERENCES assistant_page_bindings(id,user_id,agent_grant_id) ON DELETE CASCADE,
  binding_revision integer NOT NULL CHECK(binding_revision>0),
  doc_version integer NOT NULL CHECK(doc_version>0),
  assistant_rules_revision integer NOT NULL CHECK(assistant_rules_revision>0),
  lane text NOT NULL CHECK(lane IN ('background','overnight')),
  night_id uuid,
  FOREIGN KEY(night_id,user_id) REFERENCES assistant_nights(id,user_id) ON DELETE CASCADE,
  end_at timestamptz,
  CHECK((lane='background' AND night_id IS NULL AND end_at IS NULL) OR
        (lane='overnight' AND night_id IS NOT NULL AND end_at IS NOT NULL)),
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','waiting','done','failed','cancelled')),
  lease_token uuid,
  lease_expires_at timestamptz,
  CHECK((state='running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR
        (state<>'running' AND lease_token IS NULL AND lease_expires_at IS NULL)),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  token_estimate integer NOT NULL DEFAULT 0 CHECK(token_estimate>=0),
  token_budget integer NOT NULL DEFAULT 20000 CHECK(token_budget BETWEEN 1000 AND 200000),
  proposal jsonb CHECK(proposal IS NULL OR (jsonb_typeof(proposal)='object' AND pg_column_size(proposal)<=262144)),
  waiting_id uuid,
  CHECK((state='waiting' AND waiting_id IS NOT NULL AND proposal IS NOT NULL) OR (state<>'waiting' AND waiting_id IS NULL)),
  reviewed boolean NOT NULL DEFAULT false,
  error_message text CHECK(length(error_message)<=300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(binding_id,binding_revision,scheduled_for)
);
CREATE UNIQUE INDEX assistant_page_run_active ON assistant_page_runs(binding_id) WHERE state IN ('queued','running','waiting');
CREATE INDEX assistant_page_runs_claim ON assistant_page_runs(lane,state,lease_expires_at,created_at);
CREATE INDEX assistant_page_runs_owner ON assistant_page_runs(user_id,created_at DESC);
