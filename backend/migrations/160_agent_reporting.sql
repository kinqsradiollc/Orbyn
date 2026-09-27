-- H7: you always know what happened.
--
-- 1. What each agent change made, counted by kind ({"task": 3, "card": 12}),
--    so a job can be told in plain words ("Claude added 12 cards and 3
--    tasks"), and when the notifier last looked at it (reported_at): a job
--    or a burst of calls over 20 changes gets one push, once. Rows already
--    here count as looked at, so nobody is told about old work.
-- 2. "via <agent>" on more of what people see: a task's updates, page
--    comments and suggestions, Recent changes, notices an agent's change
--    caused, and the page an agent wrote last (agenda pages included).
--    Filled by the same trigger as project history and page versions
--    (fill_via_grant, from orbyn.agent_grant, set only by lib/actor.ts).
--
-- Safe to run again.

ALTER TABLE agent_activity
  ADD COLUMN IF NOT EXISTS changes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kinds jsonb,
  ADD COLUMN IF NOT EXISTS reported_at timestamptz DEFAULT now();
ALTER TABLE agent_activity ALTER COLUMN reported_at DROP DEFAULT;
CREATE INDEX IF NOT EXISTS agent_activity_unreported_idx
  ON agent_activity (grant_id, at) WHERE reported_at IS NULL AND tier <> 'R';

-- A task's updates (add_progress, completing with a note).
ALTER TABLE item_updates ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
DROP TRIGGER IF EXISTS item_updates_via_grant ON item_updates;
CREATE TRIGGER item_updates_via_grant BEFORE INSERT ON item_updates
  FOR EACH ROW EXECUTE FUNCTION fill_via_grant();

-- Page comments and suggestions.
ALTER TABLE doc_comments ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
DROP TRIGGER IF EXISTS doc_comments_via_grant ON doc_comments;
CREATE TRIGGER doc_comments_via_grant BEFORE INSERT ON doc_comments
  FOR EACH ROW EXECUTE FUNCTION fill_via_grant();
ALTER TABLE doc_suggestions ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
DROP TRIGGER IF EXISTS doc_suggestions_via_grant ON doc_suggestions;
CREATE TRIGGER doc_suggestions_via_grant BEFORE INSERT ON doc_suggestions
  FOR EACH ROW EXECUTE FUNCTION fill_via_grant();

-- Notices a change caused (a mention, an ask, a promise, an invite…). A
-- reminder or a planner heads-up is about the thing, not who made it, so
-- those stay unlabelled.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION fill_notice_via() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_id uuid := nullif(current_setting('orbyn.agent_grant', true), '')::uuid;
BEGIN
  IF NEW.via_grant_id IS NULL AND grant_id IS NOT NULL
    AND NEW.kind IS NOT NULL
    AND NEW.kind NOT IN ('reminder', 'booker_reminder', 'session', 'conflict',
      'rollforward', 'at_risk', 'deadline')
    AND EXISTS (SELECT 1 FROM agent_grants g WHERE g.id = grant_id) THEN
    NEW.via_grant_id := grant_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notifications_via_grant ON notifications;
CREATE TRIGGER notifications_via_grant BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION fill_notice_via();

-- The agent that last wrote a page's words (null once a person does).
-- Agenda pages are written on their own connection, so the agent's call
-- sets it afterwards.
ALTER TABLE docs ADD COLUMN IF NOT EXISTS written_via uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION docs_written_via() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_id uuid := nullif(current_setting('orbyn.agent_grant', true), '')::uuid;
BEGIN
  IF grant_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM agent_grants g WHERE g.id = grant_id) THEN
    grant_id := NULL;
  END IF;
  NEW.written_via := grant_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS docs_written_via ON docs;
CREATE TRIGGER docs_written_via BEFORE INSERT OR UPDATE OF title, content ON docs
  FOR EACH ROW EXECUTE FUNCTION docs_written_via();

-- Recent changes: which agent, and an agent's edits never fold into the
-- person's own (or another agent's).
ALTER TABLE team_changes ADD COLUMN IF NOT EXISTS via_grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION note_team_change(
  p_team uuid, p_kind text, p_object uuid, p_title text, p_action text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := nullif(current_setting('orbyn.user_id', true), '')::uuid;
  via uuid := nullif(current_setting('orbyn.agent_grant', true), '')::uuid;
  last_id uuid;
BEGIN
  IF p_team IS NULL OR actor IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = actor)
     OR NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team) THEN
    RETURN;
  END IF;
  IF via IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_grants WHERE id = via) THEN
    via := NULL;
  END IF;
  IF p_action = 'edited' THEN
    SELECT id INTO last_id FROM team_changes
     WHERE object_id = p_object AND user_id = actor
       AND via_grant_id IS NOT DISTINCT FROM via
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
  INSERT INTO team_changes (team_id, user_id, kind, object_id, title, action,
                            via_grant_id)
  VALUES (p_team, actor, p_kind, p_object, left(p_title, 200), p_action, via);
END;
$$;
