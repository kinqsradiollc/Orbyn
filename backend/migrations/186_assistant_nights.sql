ALTER TABLE ai_chats DROP CONSTRAINT IF EXISTS ai_chats_origin_check;
ALTER TABLE ai_chats ADD CONSTRAINT ai_chats_origin_check
  CHECK (origin IN ('person', 'idea', 'goal', 'routine', 'task', 'night'));

ALTER TABLE ai_settings ADD COLUMN night_token_budget integer NOT NULL DEFAULT 1000000
  CHECK (night_token_budget BETWEEN 1000 AND 10000000);

CREATE TABLE assistant_nights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  local_day date NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done')),
  runs integer NOT NULL DEFAULT 0 CHECK (runs BETWEEN 0 AND 10),
  budget_used integer NOT NULL DEFAULT 0 CHECK (budget_used >= 0),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, local_day)
);
CREATE TABLE assistant_night_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  night_id uuid NOT NULL REFERENCES assistant_nights ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES ai_jobs ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan', 'deadlines', 'study', 'meetings', 'tidy', 'handed', 'follow_through', 'goal', 'routine')),
  summary text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('kept', 'undone', 'partly', 'pending')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_night_runs_night ON assistant_night_runs(night_id, created_at);
