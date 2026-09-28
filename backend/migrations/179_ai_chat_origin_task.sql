-- W3: a task handed to Orbyn runs as its own chat ("Task: <title>"), listed
-- like goal and routine runs. Safe to run again.
ALTER TABLE ai_chats DROP CONSTRAINT IF EXISTS ai_chats_origin_check;
ALTER TABLE ai_chats ADD CONSTRAINT ai_chats_origin_check
  CHECK (origin IN ('person', 'idea', 'goal', 'routine', 'task'));
