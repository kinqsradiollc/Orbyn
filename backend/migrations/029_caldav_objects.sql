-- Two-way CalDAV: remember the UID a CalDAV client gave each event, so a
-- later edit or delete from the same client maps back to the right item.
-- Events created inside Orbyn have no row here; their href is the item id.
CREATE TABLE caldav_objects (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uid     text NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, uid),
  UNIQUE (item_id)
);
