-- The write and undo command commit together; retries bind to their first explicit intent.
CREATE TABLE assistant_action_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  nudge_id uuid NOT NULL,
  generation integer NOT NULL,
  intent jsonb NOT NULL,
  message text NOT NULL,
  undo_command jsonb NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  UNIQUE(user_id,nudge_id,generation)
);
CREATE INDEX assistant_action_receipts_created ON assistant_action_receipts(created_at);
