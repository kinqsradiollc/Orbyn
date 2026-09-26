-- One note per class (DAY-02): a repeating event — a weekly lecture, a daily
-- standup — is the same event many times, and each time keeps its own note.
-- `occurrence` says which time a meeting note is for: the class's first
-- start, the same instant the calendar calls `occurrence` (it doesn't move
-- when that one class is moved). A note for an event that doesn't repeat,
-- or for a whole series (every note written before this), leaves it empty.
ALTER TABLE docs ADD COLUMN IF NOT EXISTS occurrence timestamptz;

CREATE INDEX IF NOT EXISTS docs_event_note_idx
  ON docs (item_id, occurrence)
  WHERE kind = 'meeting' AND item_id IS NOT NULL;
