-- Retain an earlier task deadline long enough for the notice worker to find
-- sessions that became late. Repeating tasks advance to later dates and do
-- not enter this log.
CREATE TABLE item_deadline_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  old_deadline timestamptz,
  new_deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_deadline_moves_recent ON item_deadline_moves(created_at DESC);

CREATE FUNCTION record_item_deadline_move() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  before_due timestamptz;
  after_due timestamptz;
BEGIN
  IF NEW.kind <> 'task' THEN RETURN NEW; END IF;
  before_due := CASE WHEN OLD.end_at IS NOT NULL THEN OLD.end_at
    WHEN OLD.all_day AND OLD.due_at IS NOT NULL THEN
      ((OLD.due_at AT TIME ZONE OLD.timezone)::date + 1) AT TIME ZONE OLD.timezone
    ELSE OLD.due_at END;
  after_due := CASE WHEN NEW.end_at IS NOT NULL THEN NEW.end_at
    WHEN NEW.all_day AND NEW.due_at IS NOT NULL THEN
      ((NEW.due_at AT TIME ZONE NEW.timezone)::date + 1) AT TIME ZONE NEW.timezone
    ELSE NEW.due_at END;
  IF after_due IS NOT NULL AND (before_due IS NULL OR after_due < before_due) THEN
    INSERT INTO item_deadline_moves(item_id, old_deadline, new_deadline)
    VALUES(NEW.id, before_due, after_due);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER items_deadline_move AFTER UPDATE OF due_at, end_at, all_day, timezone ON items
  FOR EACH ROW EXECUTE FUNCTION record_item_deadline_move();
