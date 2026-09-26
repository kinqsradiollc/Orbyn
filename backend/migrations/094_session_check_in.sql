-- Session check-in: after a session ends, its person says how it went
-- ("Done for today", "Need more", "Skip"). The answer makes "still needed"
-- exact (time that went into the task counts as spent, once) and tells the
-- planner's learning which sessions were kept, instead of guessing from
-- focus time and finished tasks. A session is also marked started when its
-- person starts working on it (focus mode on its task while it runs, or
-- "Start" from its reminder). Safe to run again.

ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS outcome_at timestamptz;
-- Minutes the check-in added to the task's time spent, so a changed answer
-- takes back exactly what it gave.
ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS spent_added integer NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE time_blocks ADD CONSTRAINT time_blocks_outcome_check
    CHECK (outcome IN ('done', 'more', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Sessions still waiting for a check-in, newest first, per person.
CREATE INDEX IF NOT EXISTS time_blocks_check_in
  ON time_blocks (user_id, end_at DESC) WHERE outcome IS NULL;

-- Sessions by start time, across people, for the session reminders.
CREATE INDEX IF NOT EXISTS time_blocks_start ON time_blocks (start_at);

-- A reminder when a session starts: minutes before its start, or off (null).
ALTER TABLE planner_prefs ADD COLUMN IF NOT EXISTS session_reminder_minutes smallint;
DO $$ BEGIN
  ALTER TABLE planner_prefs ADD CONSTRAINT planner_prefs_session_reminder_check
    CHECK (session_reminder_minutes IS NULL OR session_reminder_minutes BETWEEN 0 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Session reminders are notifications of their own kind.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask',
    'promise', 'calendar', 'import', 'project', 'agent', 'session'));
