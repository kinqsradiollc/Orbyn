-- Subscribed calendars hold different things (classes, exams, shifts,
-- meetings, holidays), so each gets a kind and its own settings.
ALTER TABLE calendar_subscriptions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('classes', 'exams', 'work', 'meetings', 'holidays', 'other')),
  ADD COLUMN IF NOT EXISTS all_day_busy boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sharing text NOT NULL DEFAULT 'busy'
    CHECK (sharing IN ('busy', 'hidden')),
  ADD COLUMN IF NOT EXISTS reminder_minutes integer
    CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 0 AND 10080),
  -- A hash of the last feed read, so an unchanged feed isn't rewritten.
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Subscribed events now count as busy unless you say otherwise. "Off" was
-- only ever the default (the form didn't explain it), and with it off the
-- planner and booking pages put things on top of classes and shifts.
ALTER TABLE calendar_subscriptions ALTER COLUMN busy SET DEFAULT true;
UPDATE calendar_subscriptions SET busy = true WHERE NOT busy;

-- Reminders already sent for a subscribed occurrence, so each goes once.
CREATE TABLE IF NOT EXISTS external_reminders (
  subscription_id uuid NOT NULL REFERENCES calendar_subscriptions ON DELETE CASCADE,
  uid text NOT NULL,
  starts_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscription_id, uid, starts_at)
);
CREATE INDEX IF NOT EXISTS external_reminders_sent ON external_reminders (sent_at);

-- Reminders for subscribed events are their own kind of notice.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask',
    'promise', 'calendar'));
