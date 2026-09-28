ALTER TABLE items ADD COLUMN agent_when text NOT NULL DEFAULT 'now'
  CHECK (agent_when IN ('now', 'tonight'));
CREATE INDEX items_assistant_tonight ON items(agent_grant_id, updated_at)
  WHERE agent_when = 'tonight' AND agent_state = 'queued';
