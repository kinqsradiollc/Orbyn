-- Terms acceptance, the usage-analytics choice, and a record of each consent
-- decision (what was agreed to, which version, when), so a person can see
-- their own history and the operator can show consent was given.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_version text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS analytics_opt_out boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS consent_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('terms', 'analytics')),
  version text,
  granted boolean NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_log_user ON consent_log (user_id, at DESC);
