-- Device proof metadata only; neither provider nor Orbyn bearer tokens are stored.
CREATE TABLE chatgpt_executor_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES chatgpt_identity_connections(id) ON DELETE CASCADE,
  host_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{59}$'),
  public_key_fingerprint text NOT NULL CHECK (public_key_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  epoch bigint NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id,host_id)
);
CREATE TABLE chatgpt_executor_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES chatgpt_identity_connections(id) ON DELETE CASCADE,
  host_id uuid NOT NULL,
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9_-]{59}$'),
  public_key_fingerprint text NOT NULL CHECK (public_key_fingerprint ~ '^[A-Za-z0-9_-]{43}$'),
  expected_epoch bigint NOT NULL CHECK (expected_epoch BETWEEN 0 AND 9007199254740990),
  expected_enrollment_id uuid,
  proof_message text NOT NULL CHECK (length(proof_message) BETWEEN 32 AND 2048),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  consumed_at timestamptz
);
CREATE INDEX chatgpt_executor_challenges_owner ON chatgpt_executor_challenges(user_id,session_id);
CREATE INDEX chatgpt_executor_challenges_expiry ON chatgpt_executor_challenges(expires_at);
