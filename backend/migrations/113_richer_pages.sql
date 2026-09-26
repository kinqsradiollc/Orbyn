-- Richer links and pages (D4b).
--
-- - LNK-03: other names for pages and projects (aliases), found by the link
--   picker, the quick switcher, search and "Mentioned without a link".
-- - LNK-04: a link can point at one heading or line of a page
--   (orbyn://doc/<id>#<line>); the link index still points at the page.
-- - ORG-05: a page merged into another remembers where it went
--   (docs.merged_into), so links to it open the page it went into.
-- - EDT-14: the headings each person has folded on a page (doc_folds).
-- - EDT-01: pictures and files in pages (page_files), kept in Orbyn's own
--   file store on a volume of their own, with a per-person quota. Rows go
--   when their page is deleted for good; the sweeper clears uploads that
--   never finished, and the file store deletes the files of rows that are
--   gone. An import can keep its original file here (imports.keep_original).
--
-- Safe to run again.

-- ------------------------------------------------------------- aliases ---

ALTER TABLE docs ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

-- Other names as one string, so they can be matched by their letters.
CREATE OR REPLACE FUNCTION orbyn_aliases(names text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_to_string(names, ' '), '');
$$;

CREATE INDEX IF NOT EXISTS docs_aliases_trgm_idx
  ON docs USING gin (orbyn_aliases(aliases) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS projects_aliases_trgm_idx
  ON projects USING gin (orbyn_aliases(aliases) gin_trgm_ops);

-- A page's other names count as much as its title when searching.
CREATE OR REPLACE FUNCTION docs_search_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE extra text;
BEGIN
  -- Tags and the project name are worth finding a page by, so they are
  -- indexed with it rather than only filtered on.
  SELECT coalesce(string_agg(t.name, ' '), '') || ' ' ||
         coalesce((SELECT p.name FROM projects p WHERE p.id = NEW.project_id), '')
    INTO extra
    FROM doc_tags dt JOIN tags t ON t.id = dt.tag_id
   WHERE dt.doc_id = NEW.id;
  NEW.search :=
      setweight(to_tsvector('english', coalesce(NEW.title, '') || ' ' ||
                                       orbyn_aliases(NEW.aliases)), 'A')
   || setweight(to_tsvector('english', doc_words(NEW.content, 'heading')), 'B')
   || setweight(to_tsvector('english', coalesce(extra, '')), 'C')
   || setweight(to_tsvector('english', doc_words(NEW.content, NULL)), 'D');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS docs_search_trigger ON docs;
CREATE TRIGGER docs_search_trigger
  BEFORE INSERT OR UPDATE OF title, content, project_id, aliases ON docs
  FOR EACH ROW EXECUTE FUNCTION docs_search_refresh();

-- ---------------------------------------------------------- line links ---

-- Picker links in a page's lines, as migration 111 reads them, now also
-- when the link names a line of a page (orbyn://doc/<id>#<line>): the row
-- points at the page. Pictures and files (orbyn://file/…) aren't links.
CREATE OR REPLACE FUNCTION object_links_from_doc() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM object_links WHERE source_kind = 'doc' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.content IS DISTINCT FROM OLD.content THEN
    DELETE FROM object_links
     WHERE source_kind = 'doc' AND source_id = NEW.id AND link_kind = 'link';
    INSERT INTO object_links
      (source_kind, source_id, source_block, target_kind, target_id,
       link_kind, context)
    SELECT DISTINCT ON (block, kind, target)
           'doc', NEW.id, block, kind, target, 'link', context
      FROM (
        SELECT coalesce(nullif(b.value->>'id', ''), '#' || (b.n - 1)) AS block,
               CASE WHEN m[2] = 'event' THEN 'task' ELSE m[2] END AS kind,
               lower(m[3]) AS target,
               left(b.value->>'text', 400) AS context
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(NEW.content) = 'array'
                      THEN NEW.content ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS b(value, n),
               regexp_matches(
                 coalesce(b.value->>'text', ''),
                 '\[([^]]+)\]\(orbyn://(doc|task|project|event|person|date)/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9]{4}-[0-9]{2}-[0-9]{2})(#[A-Za-z0-9_-]{1,64})?\)',
                 'g'
               ) AS m
         WHERE coalesce(b.value->>'type', '') NOT IN ('code', 'math')
      ) found
    ON CONFLICT DO NOTHING;
    -- A task's line keeps its words as the line now reads (a line is often
    -- tied to its task before the page is saved with it).
    UPDATE object_links l
       SET context = left(b.value->>'text', 400)
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(NEW.content) = 'array'
                  THEN NEW.content ELSE '[]'::jsonb END) AS b(value)
     WHERE l.source_kind = 'doc' AND l.source_id = NEW.id
       AND l.link_kind = 'task_line' AND b.value->>'id' = l.source_block
       AND l.context IS DISTINCT FROM left(b.value->>'text', 400);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    DELETE FROM object_links
     WHERE source_kind = 'doc' AND source_id = NEW.id AND link_kind = 'project';
    IF NEW.project_id IS NOT NULL THEN
      INSERT INTO object_links
        (source_kind, source_id, target_kind, target_id, link_kind)
      VALUES ('doc', NEW.id, 'project', NEW.project_id::text, 'project')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    DELETE FROM object_links
     WHERE source_kind = 'doc' AND source_id = NEW.id AND link_kind = 'meeting';
    IF NEW.item_id IS NOT NULL THEN
      INSERT INTO object_links
        (source_kind, source_id, target_kind, target_id, link_kind)
      VALUES ('doc', NEW.id, 'task', NEW.item_id::text, 'meeting')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------- merging ---

ALTER TABLE docs ADD COLUMN IF NOT EXISTS merged_into uuid
  REFERENCES docs(id) ON DELETE SET NULL;

-- ------------------------------------------------------------- folding ---

CREATE TABLE IF NOT EXISTS doc_folds (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id     uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  block_ids  text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(block_ids) <= 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc_id)
);
CREATE INDEX IF NOT EXISTS doc_folds_doc_idx ON doc_folds (doc_id);

-- ------------------------------------------------ pictures and files ---

CREATE TABLE IF NOT EXISTS page_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who added it; its bytes count against their space.
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The page it belongs to; cleared when the page is deleted for good,
  -- and the sweeper then lets the file go.
  doc_id      uuid REFERENCES docs(id) ON DELETE SET NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 300),
  mime        text NOT NULL CHECK (char_length(mime) <= 120),
  kind        text NOT NULL CHECK (kind IN ('image', 'file')),
  bytes       bigint NOT NULL CHECK (bytes > 0),
  width       integer CHECK (width IS NULL OR width BETWEEN 1 AND 100000),
  height      integer CHECK (height IS NULL OR height BETWEEN 1 AND 100000),
  -- waiting (the upload link is out), ready, or failed.
  status      text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'ready', 'failed')),
  -- upload, or import (the original of an imported file, when kept).
  source      text NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'import')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  stored_at   timestamptz
);
CREATE INDEX IF NOT EXISTS page_files_doc_idx ON page_files (doc_id);
CREATE INDEX IF NOT EXISTS page_files_user_idx ON page_files (user_id);
CREATE INDEX IF NOT EXISTS page_files_loose_idx ON page_files (created_at)
  WHERE doc_id IS NULL OR status <> 'ready';

-- "Keep the original" when importing.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS keep_original boolean
  NOT NULL DEFAULT false;
