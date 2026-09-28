ALTER TABLE agent_settings ADD COLUMN reminder_nudges jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ai_chats DROP CONSTRAINT IF EXISTS ai_chats_origin_check;
ALTER TABLE ai_chats ADD CONSTRAINT ai_chats_origin_check
  CHECK (origin IN ('person', 'idea', 'goal', 'routine', 'task', 'night', 'reminders'));
CREATE UNIQUE INDEX ai_chats_reminders_person ON ai_chats(user_id) WHERE origin = 'reminders';

-- A sent row records the person's daily cap and 24-hour deduplication.
-- Stopping a key keeps its latest row until the source itself disappears.
CREATE TABLE assistant_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  nudge_key text NOT NULL CHECK (char_length(nudge_key) BETWEEN 1 AND 180),
  entity_kind text NOT NULL CHECK (entity_kind IN ('task', 'record', 'routine', 'habit', 'job', 'goal')),
  entity_id uuid NOT NULL,
  local_day date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  stopped boolean NOT NULL DEFAULT false
);
CREATE INDEX assistant_nudges_day ON assistant_nudges(user_id, local_day);
CREATE INDEX assistant_nudges_key ON assistant_nudges(user_id, nudge_key, sent_at DESC);
CREATE UNIQUE INDEX assistant_nudges_stopped_key ON assistant_nudges(user_id, nudge_key) WHERE stopped;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template',
    'ask', 'promise', 'calendar', 'import', 'project', 'agent', 'session',
    'review', 'question', 'system', 'assistant', 'reminder_nudge'));
CREATE UNIQUE INDEX notifications_nudge_once ON notifications(user_id, channel, destination, ref)
  WHERE kind = 'reminder_nudge';
