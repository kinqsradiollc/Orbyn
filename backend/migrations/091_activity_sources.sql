-- A project's recent changes keep where a task's title came from after the
-- task is gone. The change rows name the task by title ("Task removed: …"),
-- and an emailed task's title is the email's subject: outside agents must
-- get it fenced (or only "Task from email") for as long as the row lasts,
-- which is forever unless the owner chooses otherwise. Safe to run again.

-- The source, and the item's kind (so an event reads "Event from email"),
-- stored on the row itself when it is written.
ALTER TABLE project_activity ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE project_activity ADD COLUMN IF NOT EXISTS item_kind text;
DO $$ BEGIN
  ALTER TABLE project_activity ADD CONSTRAINT project_activity_source_check
    CHECK (source IN ('booking_guest', 'inbound_email'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An item's source row now stays until the end of the statement that
-- deletes the item, so the "Task removed" row written during that delete
-- still finds it. A foreign key's cascade would remove it first (cascades
-- run before the item's own triggers), so the row is removed by the
-- statement trigger below instead.
ALTER TABLE item_sources DROP CONSTRAINT IF EXISTS item_sources_item_id_fkey;

CREATE OR REPLACE FUNCTION drop_item_sources() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM item_sources s USING gone g WHERE s.item_id = g.id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS items_drop_sources ON items;
CREATE TRIGGER items_drop_sources AFTER DELETE ON items
  REFERENCING OLD TABLE AS gone
  FOR EACH STATEMENT EXECUTE FUNCTION drop_item_sources();

-- Filled on every change row about an item, from every write path, without
-- changing record_project_activity itself: a booking's event is the guest's
-- words, a task sent by email the email's. The kind comes from the item, or,
-- while it is being deleted, from the last row this project wrote about it.
CREATE OR REPLACE FUNCTION fill_activity_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source IS NULL AND NEW.entity_type = 'task' AND NEW.entity_id IS NOT NULL THEN
    NEW.source := CASE
      WHEN EXISTS (SELECT 1 FROM bookings bk WHERE bk.item_ids @> ARRAY[NEW.entity_id])
        THEN 'booking_guest'
      ELSE (SELECT s.source FROM item_sources s WHERE s.item_id = NEW.entity_id)
    END;
  END IF;
  IF NEW.source IS NOT NULL AND NEW.item_kind IS NULL THEN
    NEW.item_kind := coalesce(
      (SELECT i.kind FROM items i WHERE i.id = NEW.entity_id),
      (SELECT a.item_kind FROM project_activity a
        WHERE a.project_id = NEW.project_id AND a.entity_type = 'task'
          AND a.entity_id = NEW.entity_id AND a.item_kind IS NOT NULL
        ORDER BY a.created_at DESC, a.id DESC LIMIT 1));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_activity_source ON project_activity;
CREATE TRIGGER project_activity_source BEFORE INSERT ON project_activity
  FOR EACH ROW EXECUTE FUNCTION fill_activity_source();

-- The rows already written: every item sent by email is still here (its
-- source row went with it until now), and bookings keep their events' ids.
UPDATE project_activity a SET source = s.source, item_kind = i.kind
  FROM item_sources s JOIN items i ON i.id = s.item_id
 WHERE a.entity_type = 'task' AND a.entity_id = s.item_id AND a.source IS NULL;
UPDATE project_activity a SET source = 'booking_guest',
       item_kind = (SELECT i.kind FROM items i WHERE i.id = b.id)
  FROM (SELECT DISTINCT unnest(item_ids) AS id FROM bookings) b
 WHERE a.entity_type = 'task' AND a.entity_id = b.id
   AND a.source IS DISTINCT FROM 'booking_guest';
