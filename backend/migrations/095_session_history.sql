-- Sessions in a project's History: planned, moved, started and removed.
-- A session is one person's planned time, so its rows are seen only by that
-- person (session_user_id), never by teammates, whatever their role. Each
-- row also says how the change was made (origin): in the app, by the
-- planner, by the assistant, by a connected agent or from a reminder.
-- Rows about one task written by one statement are one row ("3 sessions
-- planned: …"), so applying a plan doesn't flood the History.
-- Safe to run again.

ALTER TABLE project_activity ADD COLUMN IF NOT EXISTS session_user_id uuid
  REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE project_activity ADD COLUMN IF NOT EXISTS origin text;
DO $$ BEGIN
  ALTER TABLE project_activity ADD CONSTRAINT project_activity_origin_check
    CHECK (origin IN ('app', 'planner', 'assistant', 'agent', 'reminder'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE project_activity DROP CONSTRAINT IF EXISTS project_activity_kind_check;
ALTER TABLE project_activity ADD CONSTRAINT project_activity_kind_check
  CHECK (kind IN (
    'project_created', 'project_changed', 'task_added', 'task_changed',
    'task_removed', 'note_added', 'note_changed', 'note_removed',
    'stage_added', 'stage_changed', 'stage_removed',
    'record_added', 'record_changed',
    'session_planned', 'session_moved', 'session_started', 'session_removed',
    'milestone_added', 'milestone_changed', 'milestone_removed'
  ));
ALTER TABLE project_activity DROP CONSTRAINT IF EXISTS project_activity_entity_type_check;
ALTER TABLE project_activity ADD CONSTRAINT project_activity_entity_type_check
  CHECK (entity_type IN ('project', 'task', 'note', 'stage', 'record', 'session', 'milestone'));

CREATE INDEX IF NOT EXISTS project_activity_session_user
  ON project_activity (session_user_id) WHERE session_user_id IS NOT NULL;

-- How a change was made, from what the writer said about itself: a
-- connected agent's grant wins, then set_config('orbyn.origin', …), then
-- what the row itself says (the planner, for sessions it placed).
CREATE OR REPLACE FUNCTION fill_activity_origin() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  said text := nullif(current_setting('orbyn.origin', true), '');
BEGIN
  IF nullif(current_setting('orbyn.agent_grant', true), '') IS NOT NULL THEN
    NEW.origin := 'agent';
  ELSIF said IN ('app', 'planner', 'assistant', 'agent', 'reminder') THEN
    NEW.origin := said;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS project_activity_origin ON project_activity;
CREATE TRIGGER project_activity_origin BEFORE INSERT ON project_activity
  FOR EACH ROW EXECUTE FUNCTION fill_activity_origin();

-- A session row names its task by title, so it carries the task's source
-- (a booking guest's or an email's words) the same way a task row does.
CREATE OR REPLACE FUNCTION fill_activity_source() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source IS NULL AND NEW.entity_type IN ('task', 'session')
     AND NEW.entity_id IS NOT NULL THEN
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

-- One row per (project, task, person) and kind for each statement. Removals
-- made by a cascade (a task or an account being deleted) are part of a
-- bigger change that is logged on its own, so they are left out.
CREATE OR REPLACE FUNCTION record_session_activity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := nullif(current_setting('orbyn.user_id', true), '')::uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
      entity_id, summary, after_state, session_user_id, origin)
    SELECT i.project_id, coalesce(actor, n.user_id), 'session_planned', 'session',
      n.item_id,
      left(CASE WHEN count(*) = 1 THEN 'Session planned: '
        ELSE count(*) || ' sessions planned: ' END || i.title, 240),
      jsonb_build_object('item_id', n.item_id, 'title', i.title,
        'count', count(*), 'start_at', min(n.start_at), 'end_at', max(n.end_at)),
      n.user_id,
      CASE WHEN bool_and(n.source = 'planner') THEN 'planner' ELSE 'app' END
    FROM new_sessions n JOIN items i ON i.id = n.item_id
    JOIN projects p ON p.id = i.project_id
    GROUP BY i.project_id, n.item_id, i.title, n.user_id;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
      entity_id, summary, before_state, after_state, session_user_id, origin)
    SELECT i.project_id, coalesce(actor, n.user_id), 'session_moved', 'session',
      n.item_id,
      left(CASE WHEN count(*) = 1 THEN 'Session moved: '
        ELSE count(*) || ' sessions moved: ' END || i.title, 240),
      jsonb_build_object('item_id', n.item_id, 'title', i.title,
        'count', count(*), 'start_at', min(o.start_at), 'end_at', max(o.end_at)),
      jsonb_build_object('item_id', n.item_id, 'title', i.title,
        'count', count(*), 'start_at', min(n.start_at), 'end_at', max(n.end_at)),
      n.user_id, 'app'
    FROM new_sessions n JOIN old_sessions o ON o.id = n.id
    JOIN items i ON i.id = n.item_id JOIN projects p ON p.id = i.project_id
    WHERE o.start_at IS DISTINCT FROM n.start_at OR o.end_at IS DISTINCT FROM n.end_at
    GROUP BY i.project_id, n.item_id, i.title, n.user_id;
    INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
      entity_id, summary, after_state, session_user_id, origin)
    SELECT i.project_id, coalesce(actor, n.user_id), 'session_started', 'session',
      n.item_id, left('Session started: ' || i.title, 240),
      jsonb_build_object('item_id', n.item_id, 'title', i.title, 'count', count(*),
        'start_at', min(n.start_at), 'end_at', max(n.end_at),
        'started_at', min(n.started_at)),
      n.user_id, 'app'
    FROM new_sessions n JOIN old_sessions o ON o.id = n.id
    JOIN items i ON i.id = n.item_id JOIN projects p ON p.id = i.project_id
    WHERE o.started_at IS NULL AND n.started_at IS NOT NULL
    GROUP BY i.project_id, n.item_id, i.title, n.user_id;
  ELSE
    INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
      entity_id, summary, before_state, session_user_id, origin)
    SELECT i.project_id, coalesce(actor, o.user_id), 'session_removed', 'session',
      o.item_id,
      left(CASE WHEN count(*) = 1 THEN 'Session removed: '
        ELSE count(*) || ' sessions removed: ' END || i.title, 240),
      jsonb_build_object('item_id', o.item_id, 'title', i.title,
        'count', count(*), 'start_at', min(o.start_at), 'end_at', max(o.end_at)),
      o.user_id, 'app'
    FROM old_sessions o JOIN items i ON i.id = o.item_id
    JOIN projects p ON p.id = i.project_id
    GROUP BY i.project_id, o.item_id, i.title, o.user_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS time_blocks_history_insert ON time_blocks;
DROP TRIGGER IF EXISTS time_blocks_history_update ON time_blocks;
DROP TRIGGER IF EXISTS time_blocks_history_delete ON time_blocks;
CREATE TRIGGER time_blocks_history_insert AFTER INSERT ON time_blocks
  REFERENCING NEW TABLE AS new_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION record_session_activity();
CREATE TRIGGER time_blocks_history_update AFTER UPDATE ON time_blocks
  REFERENCING OLD TABLE AS old_sessions NEW TABLE AS new_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION record_session_activity();
CREATE TRIGGER time_blocks_history_delete AFTER DELETE ON time_blocks
  REFERENCING OLD TABLE AS old_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION record_session_activity();
