-- Deliberately separate editorial drafts, public release snapshots and LinkedIn delivery.
CREATE TABLE publishing_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','scheduled','sending','published','failed','unknown')),
  approved_by uuid REFERENCES users ON DELETE SET NULL,
  scheduled_at timestamptz,
  sending_at timestamptz,
  post_urn text,
  error text,
  release jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publishing_due ON publishing_drafts(scheduled_at) WHERE state='scheduled';
CREATE TABLE publishing_linkedin (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  organization text NOT NULL,
  token_encrypted text NOT NULL,
  refresh_encrypted text,
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz
);
CREATE TABLE publishing_oauth (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  session_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
COMMENT ON TABLE publishing_drafts IS 'Admin authored public marketing drafts; images capped at 2 MB, maximum 100 retained drafts.';
