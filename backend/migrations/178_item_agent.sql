-- W3: hand a task to Orbyn. A task handed to the person's own assistant
-- (its 'assistant' grant) waits in a queue the worker takes it from; the
-- run's job, what it says it did and how far it got are kept on the task.
-- The grant is cleared when the run ends, so the task goes back to the
-- person; the state and result stay to show what happened.
-- Safe to run again.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS agent_grant_id uuid
    REFERENCES agent_grants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_state text,
  ADD COLUMN IF NOT EXISTS agent_job_id uuid,
  ADD COLUMN IF NOT EXISTS agent_result text,
  -- The worker's claim and how many runs it started (bounded retries).
  ADD COLUMN IF NOT EXISTS agent_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS agent_attempts smallint NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_agent_state_check'
  ) THEN
    ALTER TABLE items ADD CONSTRAINT items_agent_state_check
      CHECK (agent_state IN ('queued', 'working', 'done', 'needs_you'));
  END IF;
END $$;

-- The worker's scan and the per-person limit read only the handed tasks.
CREATE INDEX IF NOT EXISTS items_agent_grant_idx
  ON items (agent_grant_id) WHERE agent_grant_id IS NOT NULL;
