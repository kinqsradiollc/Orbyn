-- Capture real transitions from this release onward. Earlier completion dates
-- cannot be reconstructed reliably from the current item or progress note.
CREATE TABLE item_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_completions_user_at ON item_completions(user_id, created_at);
CREATE INDEX item_completions_item ON item_completions(item_id);
CREATE TABLE activity_history_start (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO activity_history_start(singleton) VALUES(true);
