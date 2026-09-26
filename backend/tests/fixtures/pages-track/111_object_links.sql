-- Links between things (LNK-01, LNK-02, LNK-05): one row per connection from
-- a page, task or comment to a page, task, project, person or date. It is
-- the index "Linked here" reads, and the one the agents' get_links reads.
--
-- Rows are derived, never typed in: triggers keep them in step with what
-- they come from, so every way a page is saved (the editor, a restore, a
-- suggestion, an import, the assistant) fills it the same way.
--
-- - link:       a pill from the link picker, stored in the page as a
--               Markdown link to orbyn://<kind>/<id>;
-- - mention:    a person named in a comment on a page;
-- - task_line:  a checklist line that became a task (doc_task_links);
-- - dependency: a task that waits for another (item_dependencies);
-- - project:    a page filed in a project (docs.project_id);
-- - meeting:    a meeting note for an event (docs.item_id).
--
-- Tasks and events are both 'task' as a kind: they are one table, and a link
-- keeps working when one becomes the other. `target_id` is text because a
-- date is linked by its day (2026-09-26). Who may see a row is decided when
-- it is read, from its source and target, never stored here.
--
-- Safe to run again.
CREATE TABLE IF NOT EXISTS object_links (
  source_kind  text NOT NULL CHECK (source_kind IN ('doc', 'task')),
  source_id    uuid NOT NULL,
  -- The line it sits on: a block id, '#<n>' for a line without one, a
  -- comment id for a mention, or '' for the whole thing.
  source_block text NOT NULL DEFAULT '',
  target_kind  text NOT NULL
    CHECK (target_kind IN ('doc', 'task', 'project', 'person', 'date')),
  target_id    text NOT NULL,
  link_kind    text NOT NULL
    CHECK (link_kind IN ('link', 'mention', 'task_line', 'dependency',
                         'project', 'meeting')),
  -- The words of the line it sits on (Markdown, at most 400 characters).
  context      text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id, link_kind, source_block,
               target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS object_links_target_idx
  ON object_links (target_kind, target_id);

-- Picker links in a page's lines. Code and maths are literal, so a link
-- written inside them is text.
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
                 '\[([^]]+)\]\(orbyn://(doc|task|project|event|person|date)/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9]{4}-[0-9]{2}-[0-9]{2})\)',
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

DROP TRIGGER IF EXISTS docs_object_links ON docs;
CREATE TRIGGER docs_object_links
  AFTER INSERT OR UPDATE OF content, project_id, item_id OR DELETE ON docs
  FOR EACH ROW EXECUTE FUNCTION object_links_from_doc();

-- A checklist line that became a task: the page links to the task, with
-- the line's words as it was when they were tied together.
CREATE OR REPLACE FUNCTION object_links_from_task_line() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM object_links
     WHERE source_kind = 'doc' AND source_id = OLD.doc_id
       AND link_kind = 'task_line' AND source_block = OLD.block_id;
    RETURN OLD;
  END IF;
  INSERT INTO object_links
    (source_kind, source_id, source_block, target_kind, target_id,
     link_kind, context)
  SELECT 'doc', NEW.doc_id, NEW.block_id, 'task', NEW.item_id::text,
         'task_line',
         coalesce((SELECT left(b->>'text', 400)
                     FROM docs d,
                          jsonb_array_elements(
                            CASE WHEN jsonb_typeof(d.content) = 'array'
                                 THEN d.content ELSE '[]'::jsonb END) b
                    WHERE d.id = NEW.doc_id AND b->>'id' = NEW.block_id
                    LIMIT 1), '')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doc_task_links_object_links ON doc_task_links;
CREATE TRIGGER doc_task_links_object_links
  AFTER INSERT OR DELETE ON doc_task_links
  FOR EACH ROW EXECUTE FUNCTION object_links_from_task_line();

-- A task that waits for another links to the one it waits for.
CREATE OR REPLACE FUNCTION object_links_from_dependency() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM object_links
     WHERE source_kind = 'task' AND source_id = OLD.item_id
       AND link_kind = 'dependency' AND target_id = OLD.prerequisite_id::text;
    RETURN OLD;
  END IF;
  INSERT INTO object_links
    (source_kind, source_id, target_kind, target_id, link_kind)
  VALUES ('task', NEW.item_id, 'task', NEW.prerequisite_id::text, 'dependency')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS item_dependencies_object_links ON item_dependencies;
CREATE TRIGGER item_dependencies_object_links
  AFTER INSERT OR DELETE ON item_dependencies
  FOR EACH ROW EXECUTE FUNCTION object_links_from_dependency();

-- A person named in a comment on a page.
CREATE OR REPLACE FUNCTION object_links_from_mention() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM object_links
     WHERE link_kind = 'mention' AND source_block = OLD.comment_id::text
       AND target_kind = 'person' AND target_id = OLD.user_id::text;
    RETURN OLD;
  END IF;
  INSERT INTO object_links
    (source_kind, source_id, source_block, target_kind, target_id,
     link_kind, context)
  SELECT 'doc', c.doc_id, c.id::text, 'person', NEW.user_id::text, 'mention',
         left(c.body, 400)
    FROM doc_comments c WHERE c.id = NEW.comment_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doc_comment_mentions_object_links ON doc_comment_mentions;
CREATE TRIGGER doc_comment_mentions_object_links
  AFTER INSERT OR DELETE ON doc_comment_mentions
  FOR EACH ROW EXECUTE FUNCTION object_links_from_mention();

-- A task deleted for good takes the links it made with it.
CREATE OR REPLACE FUNCTION object_links_drop_task() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM object_links WHERE source_kind = 'task' AND source_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS items_object_links ON items;
CREATE TRIGGER items_object_links
  AFTER DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION object_links_drop_task();

-- Seed from the connections that already exist. No page holds a picker link
-- yet (the picker arrives with this table), so there are none to read.
INSERT INTO object_links
  (source_kind, source_id, source_block, target_kind, target_id, link_kind,
   context)
SELECT 'doc', l.doc_id, l.block_id, 'task', l.item_id::text, 'task_line',
       coalesce((SELECT left(b->>'text', 400)
                   FROM jsonb_array_elements(
                          CASE WHEN jsonb_typeof(d.content) = 'array'
                               THEN d.content ELSE '[]'::jsonb END) b
                  WHERE b->>'id' = l.block_id LIMIT 1), '')
  FROM doc_task_links l JOIN docs d ON d.id = l.doc_id
ON CONFLICT DO NOTHING;

INSERT INTO object_links (source_kind, source_id, target_kind, target_id, link_kind)
SELECT 'task', item_id, 'task', prerequisite_id::text, 'dependency'
  FROM item_dependencies
ON CONFLICT DO NOTHING;

INSERT INTO object_links (source_kind, source_id, target_kind, target_id, link_kind)
SELECT 'doc', id, 'project', project_id::text, 'project'
  FROM docs WHERE project_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO object_links (source_kind, source_id, target_kind, target_id, link_kind)
SELECT 'doc', id, 'task', item_id::text, 'meeting'
  FROM docs WHERE item_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO object_links
  (source_kind, source_id, source_block, target_kind, target_id, link_kind,
   context)
SELECT 'doc', c.doc_id, c.id::text, 'person', m.user_id::text, 'mention',
       left(c.body, 400)
  FROM doc_comment_mentions m JOIN doc_comments c ON c.id = m.comment_id
ON CONFLICT DO NOTHING;
