-- Stable source identities let a reminder remain stopped when an exam is renamed.
ALTER TABLE study_exams ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX study_exams_id ON study_exams(id);
ALTER TABLE assistant_nudges DROP CONSTRAINT assistant_nudges_entity_kind_check;
ALTER TABLE assistant_nudges ADD CONSTRAINT assistant_nudges_entity_kind_check
  CHECK (entity_kind IN ('task', 'record', 'routine', 'habit', 'job', 'goal', 'comment', 'exam'));

-- A past habit session is not assumed completed: its person records the outcome.
ALTER TABLE habit_blocks ADD COLUMN outcome text CHECK (outcome IN ('done', 'skipped'));
ALTER TABLE habit_blocks ADD COLUMN outcome_at timestamptz;
CREATE INDEX habit_blocks_check_in ON habit_blocks(user_id, end_at DESC) WHERE outcome IS NULL;
ALTER TABLE habit_blocks ADD COLUMN version integer NOT NULL DEFAULT 1;
