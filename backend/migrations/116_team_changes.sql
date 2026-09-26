-- Recent changes per team (SHR-02): who created, edited, finished or deleted
-- which of a team's pages and tasks, and when, so a team can catch up after
-- a weekend.
--
-- Rows are written by triggers, so every way a page or task changes (the
-- editor, the API, the assistant, an agent, an import) is counted the same
-- way. Only changes someone made are kept: the app says who is acting with
-- set_config('orbyn.user_id', …) inside the change's transaction, and a
-- change with no one behind it (the notifier, a recount of progress, the
-- sweeper) is not news. Only what a reader would notice counts: a title,
-- words, dates, status or who it is for.
--
-- A burst of edits is one row: a second edit by the same person to the same
-- thing within 30 minutes moves that row's time on and counts it, so typing
-- a page for an hour reads as one or two entries, not three hundred.
--
-- The sweeper drops rows after 90 days. Safe to run again.

CREATE TABLE IF NOT EXISTS team_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('page', 'task', 'event', 'reminder')),
  object_id  uuid NOT NULL,
  -- The title when it last changed, so a deleted thing still reads.
  title      text NOT NULL DEFAULT '',
  action     text NOT NULL
    CHECK (action IN ('created', 'edited', 'done', 'reopened', 'deleted',
                      'restored')),
  edits      integer NOT NULL DEFAULT 1,
  first_at   timestamptz NOT NULL DEFAULT now(),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_changes_team_at_idx
  ON team_changes (team_id, at DESC);
CREATE INDEX IF NOT EXISTS team_changes_object_idx
  ON team_changes (object_id, user_id, at DESC);
CREATE INDEX IF NOT EXISTS team_changes_at_idx ON team_changes (at);

-- Note one change, folding an edit into the same person's last one on the
-- same thing when it was under 30 minutes ago.
CREATE OR REPLACE FUNCTION note_team_change(
  p_team uuid, p_kind text, p_object uuid, p_title text, p_action text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := nullif(current_setting('orbyn.user_id', true), '')::uuid;
  last_id uuid;
BEGIN
  IF p_team IS NULL OR actor IS NULL THEN
    RETURN;
  END IF;
  -- Someone removed in the meantime is not an author, and a team being
  -- deleted (its pages and tasks go with it) has no one left to tell.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = actor)
     OR NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team) THEN
    RETURN;
  END IF;
  IF p_action = 'edited' THEN
    SELECT id INTO last_id FROM team_changes
     WHERE object_id = p_object AND user_id = actor
       AND action IN ('created', 'edited')
       AND at > now() - interval '30 minutes'
     ORDER BY at DESC LIMIT 1;
    IF last_id IS NOT NULL THEN
      UPDATE team_changes
         SET at = now(), edits = edits + 1, title = left(p_title, 200)
       WHERE id = last_id;
      RETURN;
    END IF;
  END IF;
  INSERT INTO team_changes (team_id, user_id, kind, object_id, title, action)
  VALUES (p_team, actor, p_kind, p_object, left(p_title, 200), p_action);
END;
$$;

CREATE OR REPLACE FUNCTION team_changes_docs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Agendas are each person's own day; only pages count.
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind <> 'agenda' AND NEW.deleted_at IS NULL THEN
      PERFORM note_team_change(NEW.team_id, 'page', NEW.id, NEW.title, 'created');
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- Emptied from Trash: it was already listed as deleted.
    RETURN OLD;
  END IF;
  IF NEW.kind = 'agenda' THEN
    RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM note_team_change(NEW.team_id, 'page', NEW.id, NEW.title, 'deleted');
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    PERFORM note_team_change(NEW.team_id, 'page', NEW.id, NEW.title, 'restored');
  ELSIF NEW.deleted_at IS NULL
    AND (NEW.title IS DISTINCT FROM OLD.title
         OR NEW.content IS DISTINCT FROM OLD.content) THEN
    PERFORM note_team_change(NEW.team_id, 'page', NEW.id, NEW.title, 'edited');
  ELSIF NEW.team_id IS DISTINCT FROM OLD.team_id AND NEW.team_id IS NOT NULL THEN
    -- Moved into a team: news to that team.
    PERFORM note_team_change(NEW.team_id, 'page', NEW.id, NEW.title, 'created');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_changes_docs ON docs;
CREATE TRIGGER team_changes_docs AFTER INSERT OR UPDATE ON docs
  FOR EACH ROW EXECUTE FUNCTION team_changes_docs();

CREATE OR REPLACE FUNCTION team_changes_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM note_team_change(NEW.team_id, NEW.kind, NEW.id, NEW.title, 'created');
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM note_team_change(OLD.team_id, OLD.kind, OLD.id, OLD.title, 'deleted');
    RETURN OLD;
  END IF;
  IF NEW.team_id IS DISTINCT FROM OLD.team_id AND NEW.team_id IS NOT NULL THEN
    PERFORM note_team_change(NEW.team_id, NEW.kind, NEW.id, NEW.title, 'created');
  ELSIF NEW.status = 'done' AND OLD.status <> 'done' THEN
    PERFORM note_team_change(NEW.team_id, NEW.kind, NEW.id, NEW.title, 'done');
  ELSIF OLD.status = 'done' AND NEW.status <> 'done' THEN
    PERFORM note_team_change(NEW.team_id, NEW.kind, NEW.id, NEW.title, 'reopened');
  ELSIF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.end_at IS DISTINCT FROM OLD.end_at
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    PERFORM note_team_change(NEW.team_id, NEW.kind, NEW.id, NEW.title, 'edited');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS team_changes_items ON items;
CREATE TRIGGER team_changes_items AFTER INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION team_changes_items();
