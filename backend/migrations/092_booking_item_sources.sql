-- A booking's events keep where their words came from on the events
-- themselves. Until now that was read from bookings.item_ids, but deleting
-- a booking page deletes its bookings and leaves the events on the hosts'
-- calendars: from then on the guest's name, note, answers and email address
-- read as the person's own. Safe to run again.

-- project_activity_source_check (077) allows the same two sources: a new
-- source must widen both, or every project change to such an item fails.
ALTER TABLE item_sources DROP CONSTRAINT IF EXISTS item_sources_source_check;
ALTER TABLE item_sources ADD CONSTRAINT item_sources_source_check
  CHECK (source IN ('booking_guest', 'inbound_email'));

-- Every booking's events that are still there.
INSERT INTO item_sources (item_id, source)
SELECT DISTINCT b.id, 'booking_guest'
  FROM (SELECT unnest(item_ids) AS id FROM bookings) b
  JOIN items i ON i.id = b.id
ON CONFLICT (item_id) DO NOTHING;

-- A project's change rows read the item's own source first; a booking that
-- still names the item is the fallback.
CREATE OR REPLACE FUNCTION fill_activity_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source IS NULL AND NEW.entity_type = 'task' AND NEW.entity_id IS NOT NULL THEN
    NEW.source := coalesce(
      (SELECT s.source FROM item_sources s WHERE s.item_id = NEW.entity_id),
      CASE WHEN EXISTS (SELECT 1 FROM bookings bk WHERE bk.item_ids @> ARRAY[NEW.entity_id])
        THEN 'booking_guest' END);
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
