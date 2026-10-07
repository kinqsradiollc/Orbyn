-- Content-free, owner-scoped provider measurements; never prompts or credentials.
CREATE TABLE managed_ai_usage (
  event_key text PRIMARY KEY CHECK (event_key ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  input_tokens bigint CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
  output_tokens bigint CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
  reasoning_tokens bigint CHECK (reasoning_tokens BETWEEN 0 AND 9007199254740991),
  cached_input_tokens bigint CHECK (cached_input_tokens BETWEEN 0 AND 9007199254740991),
  cache_write_tokens bigint CHECK (cache_write_tokens BETWEEN 0 AND 9007199254740991),
  CHECK (reasoning_tokens IS NULL OR output_tokens IS NULL OR reasoning_tokens <= output_tokens),
  CHECK (cached_input_tokens IS NULL OR cache_write_tokens IS NULL OR input_tokens IS NULL
    OR cached_input_tokens + cache_write_tokens <= input_tokens)
);
CREATE INDEX managed_ai_usage_owner_time ON managed_ai_usage(user_id,completed_at DESC);
