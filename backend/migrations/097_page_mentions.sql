-- @mentions in a page: "@Anna" written into a line is kept as a link to the
-- person, and this table says who each page names, on which line, so they
-- are told once and can find it again under "Mentioned in". Only people who
-- can already open the page are recorded: a mention never shows a page, or
-- its title, to anyone else. Safe to run again.

CREATE TABLE IF NOT EXISTS doc_mentions (
  doc_id        uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The line's own id ('' for a line without one).
  block_id      text NOT NULL DEFAULT '',
  mentioned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, user_id, block_id)
);
CREATE INDEX IF NOT EXISTS doc_mentions_person
  ON doc_mentions (user_id, created_at DESC);

-- Kept from every write path (the app, live editing, accepted suggestions,
-- agents): after a page's lines change, who it names is read again from
-- the links to people in it ("[@Name](/app/person/<id>)"). A person named
-- for the first time on a line is told once, in the app. Someone who can't
-- open the page is never recorded or told.
-- The people a page's lines name who may open it (never the writer).
CREATE OR REPLACE FUNCTION page_mentions_of(content jsonb, team uuid, owner uuid,
  actor uuid) RETURNS TABLE (user_id uuid, block_id text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT x.user_id, x.block_id FROM (
    SELECT m[1]::uuid AS user_id, coalesce(b->>'id', '') AS block_id
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(content) = 'array'
                                     THEN content ELSE '[]'::jsonb END) b,
           regexp_matches(coalesce(b->>'text', ''),
             '\]\(/app/person/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
             'g') m
  ) x
  JOIN users u ON u.id = x.user_id AND NOT u.disabled
  WHERE x.user_id IS DISTINCT FROM actor
    AND ((team IS NULL AND u.id = owner)
      OR EXISTS (SELECT 1 FROM team_members tm
                  WHERE tm.team_id = team AND tm.user_id = u.id));
$$;

CREATE OR REPLACE FUNCTION record_page_mentions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := nullif(current_setting('orbyn.user_id', true), '')::uuid;
  actor_name text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NULL; END IF;
  DELETE FROM doc_mentions dm WHERE dm.doc_id = NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM page_mentions_of(NEW.content, NEW.team_id, NEW.user_id, NULL) t
       WHERE t.user_id = dm.user_id AND t.block_id = dm.block_id);
  SELECT name INTO actor_name FROM users WHERE id = actor;
  WITH added AS (
    INSERT INTO doc_mentions (doc_id, user_id, block_id, mentioned_by)
    SELECT NEW.id, t.user_id, t.block_id, actor
      FROM page_mentions_of(NEW.content, NEW.team_id, NEW.user_id, actor) t
    ON CONFLICT DO NOTHING
    RETURNING user_id, block_id
  ), fresh AS (
    -- One notice per person per change, and none for someone the page
    -- already named on another line (they know about it).
    SELECT a.user_id, min(a.block_id) AS block_id FROM added a
     WHERE NOT EXISTS (SELECT 1 FROM doc_mentions o
                        WHERE o.doc_id = NEW.id AND o.user_id = a.user_id
                          AND o.block_id <> a.block_id
                          AND o.created_at < now())
     GROUP BY a.user_id
  )
  INSERT INTO notifications (user_id, item_id, item_version, channel,
    destination, title, body, state, kind, ref)
  SELECT f.user_id, NULL, 0, 'inapp', '',
    left(coalesce(actor_name, 'Someone') || ' mentioned you in '
      || coalesce(nullif(NEW.title, ''), 'a page'), 200),
    '', 'sent', 'mention', 'doc:' || NEW.id || ':' || f.block_id
  FROM fresh f;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS docs_mentions_insert ON docs;
DROP TRIGGER IF EXISTS docs_mentions_update ON docs;
CREATE TRIGGER docs_mentions_insert AFTER INSERT ON docs
  FOR EACH ROW WHEN (NEW.content::text LIKE '%/app/person/%')
  EXECUTE FUNCTION record_page_mentions();
CREATE TRIGGER docs_mentions_update AFTER UPDATE OF content, team_id, user_id ON docs
  FOR EACH ROW WHEN (NEW.content::text LIKE '%/app/person/%'
    OR OLD.content::text LIKE '%/app/person/%')
  EXECUTE FUNCTION record_page_mentions();
