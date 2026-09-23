-- Whether someone picked their planner time zone themselves. Until they do,
-- the apps adopt the device's zone (the default was UTC, so everything the
-- server wrote — agendas, digests, reminders, working hours — was in UTC
-- for anyone who never opened Planning settings).
ALTER TABLE planner_prefs
  ADD COLUMN IF NOT EXISTS timezone_chosen boolean NOT NULL DEFAULT false;
-- A zone other than the default was chosen on purpose.
UPDATE planner_prefs SET timezone_chosen = true WHERE timezone <> 'UTC';
