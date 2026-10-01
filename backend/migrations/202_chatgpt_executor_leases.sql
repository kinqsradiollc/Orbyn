-- First-party device presence and catalog metadata; no provider credentials.
CREATE TABLE chatgpt_executor_leases (
  executor_id uuid PRIMARY KEY REFERENCES chatgpt_executor_enrollments(id) ON DELETE CASCADE,
  enrollment_epoch bigint NOT NULL CHECK (enrollment_epoch BETWEEN 1 AND 9007199254740991),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  epoch bigint NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  heartbeat_sequence bigint NOT NULL DEFAULT 0 CHECK (heartbeat_sequence BETWEEN 0 AND 9007199254740991),
  expires_at timestamptz NOT NULL
);
CREATE TABLE chatgpt_lease_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  executor_id uuid NOT NULL REFERENCES chatgpt_executor_enrollments(id) ON DELETE CASCADE,
  enrollment_epoch bigint NOT NULL CHECK (enrollment_epoch BETWEEN 1 AND 9007199254740991),
  expected_lease_epoch bigint NOT NULL CHECK (expected_lease_epoch BETWEEN 0 AND 9007199254740990),
  proof_message text NOT NULL CHECK (length(proof_message) BETWEEN 32 AND 2048),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '5 minutes',
  consumed_at timestamptz
);
CREATE INDEX chatgpt_lease_challenges_owner ON chatgpt_lease_challenges(user_id,session_id);
CREATE INDEX chatgpt_lease_challenges_expiry ON chatgpt_lease_challenges(expires_at);
CREATE TABLE chatgpt_executor_catalogs (
  executor_id uuid PRIMARY KEY REFERENCES chatgpt_executor_enrollments(id) ON DELETE CASCADE,
  enrollment_epoch bigint NOT NULL CHECK (enrollment_epoch BETWEEN 1 AND 9007199254740991),
  lease_epoch bigint NOT NULL CHECK (lease_epoch BETWEEN 1 AND 9007199254740991),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  models jsonb NOT NULL CHECK (jsonb_typeof(models)='array' AND jsonb_array_length(models)<=1000),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
