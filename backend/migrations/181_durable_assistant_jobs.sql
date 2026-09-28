-- Jobs remain addressable through their saved chat after a client disconnects.
ALTER TABLE ai_jobs ADD COLUMN chat_id uuid REFERENCES ai_chats(id) ON DELETE CASCADE;
ALTER TABLE ai_jobs ADD COLUMN turn_id uuid;
ALTER TABLE ai_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE ai_jobs ADD COLUMN claimed_by text;
ALTER TABLE ai_jobs ADD COLUMN resume_count integer NOT NULL DEFAULT 0;
ALTER TABLE ai_jobs ADD COLUMN last_polled_at timestamptz;

UPDATE ai_jobs j SET chat_id = c.id
FROM ai_chats c
WHERE j.run_state->'request'->>'chat_id' = c.id::text
  AND j.user_id = c.user_id;
UPDATE ai_jobs SET turn_id = (run_state->'request'->>'turn_id')::uuid
WHERE run_state->'request'->>'turn_id'
  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE ai_jobs DROP CONSTRAINT ai_jobs_state_check;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_state_check
  CHECK (state IN ('queued', 'running', 'waiting', 'done', 'failed'));
CREATE INDEX ai_jobs_chat_active_idx ON ai_jobs(chat_id)
  WHERE state IN ('queued', 'running', 'waiting');
CREATE INDEX ai_jobs_queue_idx ON ai_jobs(created_at)
  WHERE state IN ('queued', 'running');
