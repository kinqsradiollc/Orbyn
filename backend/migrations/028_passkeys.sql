-- Passkeys (WebAuthn), on top of the password. Additive: password sign-in is
-- unchanged, so a passkey problem never locks anyone out.
CREATE TABLE webauthn_credentials (
  id text PRIMARY KEY,              -- credential id, base64url
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX webauthn_credentials_user ON webauthn_credentials (user_id);

-- Short-lived registration/sign-in challenges. Keyed by an opaque handle
-- (the user id for registration; a random id for pre-sign-in).
CREATE TABLE webauthn_challenges (
  handle text PRIMARY KEY,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
