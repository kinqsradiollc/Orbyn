ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template',
    'ask', 'promise', 'calendar', 'import', 'project', 'agent', 'session',
    'review', 'question', 'system', 'assistant'));

CREATE UNIQUE INDEX notifications_assistant_once
  ON notifications(user_id, channel, destination, ref)
  WHERE kind = 'assistant';
