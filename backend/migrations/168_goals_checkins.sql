-- Goals keep their own private plan note and a compact, dated progress history.
CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  target text NOT NULL DEFAULT '' CHECK (char_length(target) <= 2000),
  target_date date,
  plan_doc_id uuid REFERENCES docs(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Safe upgrades if an earlier local build created the table before these
-- columns were added to the feature.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_date date;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS plan_doc_id uuid REFERENCES docs(id) ON DELETE SET NULL;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE goals ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS goals_user_status_idx ON goals (user_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS goals_plan_doc_idx ON goals (plan_doc_id) WHERE plan_doc_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS goals_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_of date NOT NULL,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 2000),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'done' CHECK (status IN ('scheduled', 'running', 'done', 'failed')),
  job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, week_of)
);

ALTER TABLE goals_checkins ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'done';
ALTER TABLE goals_checkins ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL;
ALTER TABLE goals_checkins ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE goals_checkins DROP CONSTRAINT IF EXISTS goals_checkins_status_check;
ALTER TABLE goals_checkins ADD CONSTRAINT goals_checkins_status_check
  CHECK (status IN ('scheduled', 'running', 'done', 'failed'));

CREATE INDEX IF NOT EXISTS goals_checkins_user_idx ON goals_checkins (user_id, week_of DESC);
