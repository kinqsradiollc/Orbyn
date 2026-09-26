-- Pictures and files follow the pages that show them (D4b review).
--
-- A picture or file (page_files) belongs to the page it was added to, but a
-- line showing it can be moved, merged, copied or pasted into another page.
-- page_file_refs is every page whose lines (or kept original) point at a
-- file, kept by a trigger on docs, so:
--
-- - whoever can read a live page that shows a file can show it, wherever it
--   was first added;
-- - a file no page points at any more is marked (page_files.unused_since),
--   and the sweeper lets it go 30 days later (time for undo and history),
--   so removing a picture's line frees its space.
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS page_file_refs (
  file_id uuid NOT NULL REFERENCES page_files(id) ON DELETE CASCADE,
  doc_id  uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, doc_id)
);
CREATE INDEX IF NOT EXISTS page_file_refs_doc_idx ON page_file_refs (doc_id);

-- When the last page pointing at a file stopped pointing at it.
ALTER TABLE page_files ADD COLUMN IF NOT EXISTS unused_since timestamptz;
CREATE INDEX IF NOT EXISTS page_files_unused_idx ON page_files (unused_since)
  WHERE unused_since IS NOT NULL;

-- The files a page's lines and kept original point at.
CREATE OR REPLACE FUNCTION page_file_ids(content jsonb, imported_from jsonb)
RETURNS uuid[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT id), '{}') FROM (
    SELECT lower(b.value->>'file')::uuid AS id
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(content) = 'array'
                  THEN content ELSE '[]'::jsonb END) AS b(value)
     WHERE b.value->>'type' IN ('image', 'file')
       AND b.value->>'file' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    UNION ALL
    SELECT lower(imported_from->>'original_file')::uuid
     WHERE jsonb_typeof(imported_from) = 'object'
       AND imported_from->>'original_file' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) found;
$$;

CREATE OR REPLACE FUNCTION page_file_refs_from_doc() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.content IS NOT DISTINCT FROM OLD.content
     AND NEW.imported_from IS NOT DISTINCT FROM OLD.imported_from THEN
    RETURN NEW;
  END IF;
  ids := page_file_ids(NEW.content, NEW.imported_from);
  -- Most pages hold no files: nothing to do.
  IF cardinality(ids) = 0 AND (TG_OP = 'INSERT' OR NOT EXISTS (
       SELECT 1 FROM page_file_refs WHERE doc_id = NEW.id)) THEN
    RETURN NEW;
  END IF;
  DELETE FROM page_file_refs
   WHERE doc_id = NEW.id AND NOT (file_id = ANY (ids));
  INSERT INTO page_file_refs (file_id, doc_id)
  SELECT f.id, NEW.id FROM page_files f WHERE f.id = ANY (ids)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS page_file_refs_trigger ON docs;
CREATE TRIGGER page_file_refs_trigger
  AFTER INSERT OR UPDATE OF content, imported_from ON docs
  FOR EACH ROW EXECUTE FUNCTION page_file_refs_from_doc();

-- A file shown again is in use; one no page shows any more (a line removed,
-- or the last page showing it deleted for good) starts its 30 days.
CREATE OR REPLACE FUNCTION page_file_refs_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE page_files SET unused_since = NULL
     WHERE id = NEW.file_id AND unused_since IS NOT NULL;
    RETURN NEW;
  END IF;
  UPDATE page_files f SET unused_since = now()
   WHERE f.id = OLD.file_id AND f.unused_since IS NULL
     AND NOT EXISTS (SELECT 1 FROM page_file_refs r WHERE r.file_id = f.id);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS page_file_refs_use_trigger ON page_file_refs;
CREATE TRIGGER page_file_refs_use_trigger
  AFTER INSERT OR DELETE ON page_file_refs
  FOR EACH ROW EXECUTE FUNCTION page_file_refs_use();

-- Pages saved before this migration.
INSERT INTO page_file_refs (file_id, doc_id)
SELECT f.id, d.id
  FROM docs d
  JOIN page_files f ON f.id = ANY (page_file_ids(d.content, d.imported_from))
 WHERE EXISTS (SELECT 1 FROM page_files)
ON CONFLICT DO NOTHING;

UPDATE page_files f SET unused_since = now()
 WHERE f.unused_since IS NULL AND f.status = 'ready'
   AND NOT EXISTS (SELECT 1 FROM page_file_refs r WHERE r.file_id = f.id);
