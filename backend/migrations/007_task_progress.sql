-- Richer task tracking: four statuses, a progress value, checklist steps, and
-- a timeline of progress updates.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE items ADD CONSTRAINT items_status_check
  CHECK (status IN ('todo', 'in_progress', 'blocked', 'done'));
ALTER TABLE items ADD COLUMN progress smallint NOT NULL DEFAULT 0
  CHECK (progress BETWEEN 0 AND 100);
UPDATE items SET progress = 100 WHERE status = 'done';

-- Counts kept on the item so list requests never recount steps or updates.
ALTER TABLE items
  ADD COLUMN steps_total integer NOT NULL DEFAULT 0,
  ADD COLUMN steps_done integer NOT NULL DEFAULT 0,
  ADD COLUMN updates_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_update_at timestamptz;

-- Reminders and due lists cover every status except done.
DROP INDEX IF EXISTS items_due;
CREATE INDEX items_due ON items (due_at) WHERE status <> 'done';

CREATE TABLE item_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_steps_item ON item_steps (item_id, position, created_at);

CREATE TABLE item_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  status text CHECK (status IS NULL OR status IN ('todo', 'in_progress', 'blocked', 'done')),
  progress smallint CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_updates_item ON item_updates (item_id, created_at DESC);
