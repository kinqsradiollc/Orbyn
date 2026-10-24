-- Receipt lifetime follows the retained destination and entries. Only a digest
-- is needed to distinguish a retried request from conflicting reuse of its ID.
CREATE TABLE assistant_conversation_answers (
  destination_id uuid NOT NULL REFERENCES assistant_conversation_streams ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  question_entry_id uuid NOT NULL REFERENCES assistant_conversation_entries ON DELETE CASCADE,
  answer_entry_id uuid NOT NULL UNIQUE REFERENCES assistant_conversation_entries ON DELETE CASCADE,
  job_id uuid NOT NULL,
  waiting_id uuid NOT NULL,
  answer_hash text NOT NULL CHECK(answer_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(destination_id,turn_id)
);
