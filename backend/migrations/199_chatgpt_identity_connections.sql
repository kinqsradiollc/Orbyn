-- Identity metadata only. Provider access/refresh tokens stay in the device runtime.
CREATE TABLE chatgpt_identity_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  expected_client_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at timestamptz
);
CREATE INDEX chatgpt_identity_challenges_owner ON chatgpt_identity_challenges(user_id,session_id);
CREATE INDEX chatgpt_identity_challenges_expiry ON chatgpt_identity_challenges(expires_at);

CREATE TABLE chatgpt_identity_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  issuer text NOT NULL CHECK(issuer='https://auth.openai.com'),
  subject text NOT NULL,
  client_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(issuer,subject,client_id)
);
CREATE INDEX chatgpt_identity_connections_owner ON chatgpt_identity_connections(user_id);
