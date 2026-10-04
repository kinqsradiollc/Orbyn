CREATE TABLE user_ai_provider_choice (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 primary_provider text NOT NULL CHECK(primary_provider IN ('default','chatgpt')),
 connection_id uuid REFERENCES chatgpt_identity_connections(id) ON DELETE SET NULL,
 executor_id uuid REFERENCES chatgpt_executor_enrollments(id) ON DELETE SET NULL,
 fallback_to_default boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(primary_provider='chatgpt' OR (connection_id IS NULL AND executor_id IS NULL AND NOT fallback_to_default))
);
