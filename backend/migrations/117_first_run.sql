-- A guided first run (DSN-02): what Orbyn is for (Study, Team or Personal),
-- an optional calendar, and a starter project with a linked brief.
--
-- first_run_at is when someone finished or skipped it; the apps show it
-- while it is empty. Everyone who already has an account has plainly found
-- their way, so they are marked done now and never see it. Safe to run
-- again: only accounts made after this runs start with it empty.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_run_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purpose text
  CHECK (purpose IS NULL OR purpose IN ('study', 'team', 'personal'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM system_settings WHERE key = 'first_run_backfilled'
  ) THEN
    UPDATE users SET first_run_at = coalesce(first_run_at, now());
    INSERT INTO system_settings (key, value, updated_at)
    VALUES ('first_run_backfilled', 'true'::jsonb, now())
    ON CONFLICT (key) DO NOTHING;
  END IF;
END;
$$;
