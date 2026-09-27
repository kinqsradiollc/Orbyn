-- Two lines of work each widened the notification kinds on their own:
-- the server clock check (122, "system") and agents' questions (157,
-- "question"). Migrations run in number order, so 157 alone would drop
-- "system"; this one allows every kind the apps send. Safe to run again.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template',
    'ask', 'promise', 'calendar', 'import', 'project', 'agent', 'session',
    'review', 'question', 'system'));
