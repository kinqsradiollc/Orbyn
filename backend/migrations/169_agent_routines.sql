-- Scheduled instructions for Orbyn's built-in assistant.
CREATE TABLE IF NOT EXISTS agent_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instruction text NOT NULL CHECK (char_length(instruction) BETWEEN 1 AND 4000),
  rrule text NOT NULL CHECK (char_length(rrule) BETWEEN 1 AND 200),
  timezone text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 64),
  next_run_at timestamptz NOT NULL,
  last_result jsonb,
  current_job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_routines_due_idx
  ON agent_routines (next_run_at, id) WHERE paused = false;
