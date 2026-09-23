-- Follow-through: coming back after time away, pages that have gone quiet,
-- agreeing on a task's date, a team's meeting budget, and proof of progress.

-- Re-entry: when this person was last active, and the stretch they were away.
CREATE TABLE reentry (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  away_from timestamptz,
  away_until timestamptz,
  dismissed_at timestamptz
);

-- Memory decay: a page confirmed still true without being changed.
ALTER TABLE docs
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Negotiated plans: someone asked someone else to do a task by a date.
CREATE TABLE task_asks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  asked_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asked_of uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'countered', 'accepted', 'declined', 'withdrawn')),
  due_at timestamptz,
  estimate_minutes integer,
  counter_due_at timestamptz,
  counter_estimate_minutes integer,
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 500),
  reply text NOT NULL DEFAULT '' CHECK (char_length(reply) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (asked_by <> asked_of)
);
-- One ask in play per task at a time.
CREATE UNIQUE INDEX task_asks_live ON task_asks (item_id)
  WHERE status IN ('open', 'countered');
CREATE INDEX task_asks_of ON task_asks (asked_of, updated_at DESC);
CREATE INDEX task_asks_by ON task_asks (asked_by, updated_at DESC);

-- Team attention budget: meeting time per person per week.
ALTER TABLE teams ADD COLUMN meeting_budget_minutes integer
  CHECK (meeting_budget_minutes IS NULL OR meeting_budget_minutes BETWEEN 30 AND 2400);

-- Proof of progress: a link or a note that shows a task moved.
CREATE TABLE item_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  url text CHECK (url IS NULL OR char_length(url) <= 2000),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (url IS NOT NULL OR note <> '')
);
CREATE INDEX item_proofs_item ON item_proofs (item_id, created_at);

-- Notices for asks and their answers.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask'));
