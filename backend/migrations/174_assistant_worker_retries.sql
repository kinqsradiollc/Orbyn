-- Bounded retries for the Assistant's background runs: a weekly goal
-- check-in and a daily idea slot are tried at most a few times, and the
-- worker can see which job each claim started. Old chat compactions keep
-- their last error for support instead of retrying silently.
ALTER TABLE goals_checkins
  ADD COLUMN IF NOT EXISTS attempts smallint NOT NULL DEFAULT 0;

ALTER TABLE assistant_idea_days
  ADD COLUMN IF NOT EXISTS attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE assistant_idea_days
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES ai_jobs(id) ON DELETE SET NULL;

ALTER TABLE ai_chats
  ADD COLUMN IF NOT EXISTS sweep_last_error text;
