-- The three build tracks each widened the notification kinds on their own:
-- sessions (094, "session"), and the Review inbox (151, "review"). Migrations
-- run in number order, so the last one alone would win; this one allows every
-- kind the apps send. Safe to run again.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template',
    'ask', 'promise', 'calendar', 'import', 'project', 'agent', 'session',
    'review'));
