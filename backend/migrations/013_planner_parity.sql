-- Planner parity: frames that repeat by rule, can count as busy and skip
-- dates; deadline and planner notice preferences; the planner's own notice
-- kinds (roll forward, at risk, due soon).

ALTER TABLE frames
  -- A subset of RFC 5545 RRULE; when set it wins over `days`.
  ADD COLUMN rrule text CHECK (rrule IS NULL OR length(rrule) <= 200),
  -- The first day of the rule, so "every 2 weeks" knows which weeks.
  ADD COLUMN series_start date,
  -- Busy frames block booking pages and teammates' meeting times.
  ADD COLUMN busy boolean NOT NULL DEFAULT false,
  -- Dates the frame is skipped on, in its own time zone.
  ADD COLUMN exdates date[] NOT NULL DEFAULT '{}',
  -- Null: the owner's planner time zone.
  ADD COLUMN timezone text;
CREATE INDEX frames_busy ON frames (user_id) WHERE busy;

ALTER TABLE planner_prefs
  ADD COLUMN deadline_notice_days smallint NOT NULL DEFAULT 1
    CHECK (deadline_notice_days BETWEEN 0 AND 14),
  -- Where planner notices go besides the app.
  ADD COLUMN planner_notices jsonb NOT NULL DEFAULT '{"push": true, "email": false}';

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk', 'deadline'));
-- A roll-forward notice isn't about one item, so notifications_once (which
-- treats every null item as different) can't keep it to one a day.
CREATE UNIQUE INDEX notifications_planner_once
  ON notifications (user_id, channel, destination, kind, ref)
  WHERE item_id IS NULL AND kind = 'rollforward';

-- "Wed 16 Sep 2026, 09:00 (Australia/Melbourne)" for reminder text. A zone
-- Postgres doesn't know falls back to UTC instead of failing every reminder.
CREATE FUNCTION orbyn_local_time(at timestamptz, zone text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN to_char(at AT TIME ZONE zone, 'Dy FMDD Mon YYYY, HH24:MI') || ' (' || zone || ')';
EXCEPTION WHEN others THEN
  RETURN to_char(at AT TIME ZONE 'UTC', 'Dy FMDD Mon YYYY, HH24:MI') || ' (UTC)';
END $$;
