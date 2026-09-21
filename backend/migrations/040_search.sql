-- Search over everything written down, ranked, in Postgres.
--
-- The index that shipped with documents was never called by any route, and
-- it was an expression index over the raw JSON, so it matched on key names
-- as readily as on words. This replaces it with a stored column that holds
-- only what a person wrote, weighted: the title counts for most, headings
-- next, tags and the project name after that, the body last.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP INDEX IF EXISTS docs_search_idx;
ALTER TABLE docs ADD COLUMN search tsvector;

/* The words in a page's body, without the JSON around them. A block that
   holds no words — a divider — contributes nothing. */
CREATE OR REPLACE FUNCTION doc_words(content jsonb, kind text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(b->>'text', ' '), '')
    FROM jsonb_array_elements(coalesce(content, '[]'::jsonb)) AS b
   WHERE b->>'text' IS NOT NULL
     AND (kind IS NULL OR (b->>'type') = kind);
$$;

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
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A')
   || setweight(to_tsvector('english', doc_words(NEW.content, 'heading')), 'B')
   || setweight(to_tsvector('english', coalesce(extra, '')), 'C')
   || setweight(to_tsvector('english', doc_words(NEW.content, NULL)), 'D');
  RETURN NEW;
END $$;

CREATE TRIGGER docs_search_trigger
  BEFORE INSERT OR UPDATE OF title, content, project_id ON docs
  FOR EACH ROW EXECUTE FUNCTION docs_search_refresh();

-- Changing a page's tags changes how it is found, and that happens in a
-- different table, so the page is touched to make the trigger run again.
CREATE OR REPLACE FUNCTION doc_tags_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE docs SET title = title
   WHERE id = coalesce(NEW.doc_id, OLD.doc_id);
  RETURN NULL;
END $$;

CREATE TRIGGER doc_tags_search_trigger
  AFTER INSERT OR DELETE ON doc_tags
  FOR EACH ROW EXECUTE FUNCTION doc_tags_touch();

CREATE INDEX docs_search_idx ON docs USING gin (search);
-- A misspelt title should still find the page, so titles are matched on
-- their letters as well as their words.
CREATE INDEX docs_title_trgm_idx ON docs USING gin (title gin_trgm_ops);

-- Tasks are searched by the same route, so one query can rank both.
ALTER TABLE items ADD COLUMN search tsvector;

CREATE OR REPLACE FUNCTION items_search_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search :=
      setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A')
   || setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'D');
  RETURN NEW;
END $$;

CREATE TRIGGER items_search_trigger
  BEFORE INSERT OR UPDATE OF title, notes ON items
  FOR EACH ROW EXECUTE FUNCTION items_search_refresh();

CREATE INDEX items_search_idx ON items USING gin (search);
CREATE INDEX items_title_trgm_idx ON items USING gin (title gin_trgm_ops);

-- Everything already written is indexed once, here.
UPDATE docs SET title = title;
UPDATE items SET title = title;
