-- Permit up to three private, reviewable Assistant ideas per local day.
ALTER TABLE assistant_idea_days
  ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;
ALTER TABLE assistant_ideas
  ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1;

ALTER TABLE assistant_idea_days
  DROP CONSTRAINT IF EXISTS assistant_idea_days_slot_check;
ALTER TABLE assistant_idea_days
  ADD CONSTRAINT assistant_idea_days_slot_check CHECK (slot BETWEEN 1 AND 3);
ALTER TABLE assistant_idea_days
  DROP CONSTRAINT IF EXISTS assistant_idea_days_pkey;
ALTER TABLE assistant_idea_days
  ADD CONSTRAINT assistant_idea_days_pkey PRIMARY KEY (user_id, local_day, slot);

ALTER TABLE assistant_ideas
  DROP CONSTRAINT IF EXISTS assistant_ideas_slot_check;
ALTER TABLE assistant_ideas
  ADD CONSTRAINT assistant_ideas_slot_check CHECK (slot BETWEEN 1 AND 3);
DROP INDEX IF EXISTS assistant_ideas_user_day_idx;
CREATE UNIQUE INDEX assistant_ideas_user_day_idx
  ON assistant_ideas (user_id, local_day, slot);
