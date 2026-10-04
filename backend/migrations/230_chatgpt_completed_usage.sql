-- User-owned measurements only: no prompts, replies, identity tokens or credentials.
CREATE TABLE chatgpt_completed_usage (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 completed_at timestamptz NOT NULL DEFAULT now(),
 input_tokens bigint,
 output_tokens bigint,
 total_tokens bigint,
 CHECK ((input_tokens IS NULL AND output_tokens IS NULL AND total_tokens IS NULL)
   OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND total_tokens IS NOT NULL
     AND input_tokens BETWEEN 0 AND 9007199254740991
     AND output_tokens BETWEEN 0 AND 9007199254740991
     AND total_tokens BETWEEN 0 AND 9007199254740991
     AND total_tokens=input_tokens+output_tokens))
);
CREATE INDEX chatgpt_completed_usage_owner_time ON chatgpt_completed_usage(user_id,completed_at DESC);
