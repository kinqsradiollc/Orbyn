-- An assistant turn running in the background: the app starts it, then asks
-- for the answer until it is there. Kept in the database because the ai
-- service runs several copies and any of them may answer the poll.
CREATE TABLE ai_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','done','failed')),
 result jsonb,
 error_status integer,
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_jobs_created_idx ON ai_jobs (created_at);
