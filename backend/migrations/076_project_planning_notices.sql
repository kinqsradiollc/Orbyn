-- A project can prompt its assignees to finish planning as its deadline nears.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask',
    'promise', 'calendar', 'import', 'project'));

CREATE UNIQUE INDEX notifications_project_once
  ON notifications (user_id, channel, destination, kind, ref)
  WHERE item_id IS NULL AND kind = 'project';
