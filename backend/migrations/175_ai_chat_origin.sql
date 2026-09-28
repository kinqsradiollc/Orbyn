-- Where a chat came from: the person, or one of the assistant's background
-- runs. Idea runs stay out of the chat list (their ideas are in Review and
-- on Today); goal and routine runs are listed under a readable title.
-- Safe to run again.
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'person';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_chats_origin_check'
  ) THEN
    ALTER TABLE ai_chats ADD CONSTRAINT ai_chats_origin_check
      CHECK (origin IN ('person', 'idea', 'goal', 'routine'));
  END IF;
END $$;
