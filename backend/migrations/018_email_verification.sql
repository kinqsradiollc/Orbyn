-- Email verification and password reset.
--
-- Existing accounts are already in use, so they count as verified. New
-- accounts start unverified only when a mail server is configured (see the
-- register route); without one there is no way to confirm an address, so the
-- app would be unusable.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
UPDATE users SET email_verified = true;

-- One row per outstanding verification or password-reset link. Only the hash
-- of the token is stored, like sessions; the link carries the token itself.
-- Links are single-use (deleted when spent) and expire.
CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user ON email_tokens (user_id, purpose);
CREATE INDEX email_tokens_expiry ON email_tokens (expires_at);
