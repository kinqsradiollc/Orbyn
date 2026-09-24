-- A project page in Trash was logged as "Note moved to Trash" when it went
-- there (docs/routes.ts noteTrash). Purging it later, by the sweeper's
-- doc_trash rule or "Delete for good", no longer adds a second, actorless
-- "Note removed" to the project's history. Same function as 061 otherwise;
-- CREATE OR REPLACE makes this safe to run again.
CREATE OR REPLACE FUNCTION record_project_activity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  project uuid;
  entity uuid;
  actor uuid := nullif(current_setting('orbyn.user_id', true), '')::uuid;
  old_project uuid;
  new_project uuid;
  old_state jsonb;
  new_state jsonb;
  event_kind text;
  event_summary text;
BEGIN
  -- A change made by a cascade (a user or project being deleted, a parent
  -- task taking its subtasks with it) is part of a bigger removal: the
  -- project it would be logged against may be going in the same statement.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  IF TG_TABLE_NAME = 'projects' THEN
    project := coalesce((new_row->>'id')::uuid, (old_row->>'id')::uuid);
    entity := project;
    old_state := CASE WHEN old_row IS NULL THEN NULL ELSE jsonb_build_object(
      'name', old_row->>'name', 'status', old_row->>'status',
      'deadline', old_row->>'deadline', 'summary', old_row->>'summary'
    ) END;
    new_state := CASE WHEN new_row IS NULL THEN NULL ELSE jsonb_build_object(
      'name', new_row->>'name', 'status', new_row->>'status',
      'deadline', new_row->>'deadline', 'summary', new_row->>'summary'
    ) END;
    event_kind := CASE WHEN TG_OP = 'INSERT' THEN 'project_created' ELSE 'project_changed' END;
    event_summary := CASE WHEN TG_OP = 'INSERT'
      THEN 'Project created: ' || (new_row->>'name')
      ELSE 'Project details changed' END;
    IF TG_OP = 'UPDATE' AND old_state = new_state THEN RETURN NEW; END IF;
    INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
      entity_id, summary, before_state, after_state)
    VALUES(project, actor, event_kind, 'project', entity, event_summary,
      old_state, new_state);
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'items' THEN
    old_project := nullif(old_row->>'project_id', '')::uuid;
    new_project := nullif(new_row->>'project_id', '')::uuid;
    entity := coalesce((new_row->>'id')::uuid, (old_row->>'id')::uuid);
    old_state := CASE WHEN old_row IS NULL THEN NULL ELSE jsonb_build_object(
      'title', old_row->>'title', 'status', old_row->>'status',
      'due_at', old_row->>'due_at', 'progress', old_row->>'progress',
      'stage_id', old_row->>'stage_id'
    ) END;
    new_state := CASE WHEN new_row IS NULL THEN NULL ELSE jsonb_build_object(
      'title', new_row->>'title', 'status', new_row->>'status',
      'due_at', new_row->>'due_at', 'progress', new_row->>'progress',
      'stage_id', new_row->>'stage_id'
    ) END;
    IF old_project IS NOT NULL
      AND EXISTS (SELECT 1 FROM projects WHERE id = old_project)
      AND (TG_OP = 'DELETE' OR old_project IS DISTINCT FROM new_project) THEN
      INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
        entity_id, summary, before_state)
      VALUES(old_project, actor,
        'task_removed',
        'task', entity, 'Task removed: ' || coalesce(old_row->>'title', 'Untitled task'),
        old_state);
    END IF;
    IF new_project IS NOT NULL AND (TG_OP = 'INSERT' OR old_project IS DISTINCT FROM new_project) THEN
      INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
        entity_id, summary, after_state)
      VALUES(new_project, actor, 'task_added', 'task', entity,
        'Task added: ' || coalesce(new_row->>'title', 'Untitled task'), new_state);
    ELSIF new_project IS NOT NULL AND TG_OP = 'UPDATE' AND old_state IS DISTINCT FROM new_state THEN
      INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
        entity_id, summary, before_state, after_state)
      VALUES(new_project, actor, 'task_changed', 'task', entity,
        'Task updated: ' || coalesce(new_row->>'title', 'Untitled task'),
        old_state, new_state);
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'docs' THEN
    old_project := nullif(old_row->>'project_id', '')::uuid;
    new_project := nullif(new_row->>'project_id', '')::uuid;
    entity := coalesce((new_row->>'id')::uuid, (old_row->>'id')::uuid);
    -- A page purged from Trash (by the sweeper or "Delete for good") was
    -- already recorded as "Note moved to Trash" when it went there; it
    -- isn't removed from the project a second time.
    IF old_project IS NOT NULL
      AND EXISTS (SELECT 1 FROM projects WHERE id = old_project)
      AND (TG_OP = 'DELETE' OR old_project IS DISTINCT FROM new_project)
      AND NOT (TG_OP = 'DELETE' AND old_row->>'deleted_at' IS NOT NULL) THEN
      INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
        entity_id, summary, before_state)
      VALUES(old_project, actor, 'note_removed', 'note', entity,
        'Note removed: ' || coalesce(old_row->>'title', 'Untitled note'),
        jsonb_build_object('title', old_row->>'title', 'version', old_row->>'version'));
    END IF;
    IF new_project IS NOT NULL AND (TG_OP = 'INSERT' OR old_project IS DISTINCT FROM new_project) THEN
      INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
        entity_id, summary, after_state)
      VALUES(new_project, actor, 'note_added', 'note', entity,
        'Note added: ' || coalesce(new_row->>'title', 'Untitled note'),
        jsonb_build_object('title', new_row->>'title', 'version', new_row->>'version'));
    ELSIF new_project IS NOT NULL AND TG_OP = 'UPDATE'
      AND (old_row->>'title' IS DISTINCT FROM new_row->>'title'
        OR old_row->>'version' IS DISTINCT FROM new_row->>'version') THEN
      INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
        entity_id, summary, before_state, after_state)
      VALUES(new_project, actor, 'note_changed', 'note', entity,
        'Note updated: ' || coalesce(new_row->>'title', 'Untitled note'),
        jsonb_build_object('title', old_row->>'title', 'version', old_row->>'version'),
        jsonb_build_object('title', new_row->>'title', 'version', new_row->>'version'));
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'project_stages' THEN
    project := coalesce((new_row->>'project_id')::uuid, (old_row->>'project_id')::uuid);
    entity := coalesce((new_row->>'id')::uuid, (old_row->>'id')::uuid);
    IF EXISTS (SELECT 1 FROM projects WHERE id = project) THEN
      old_state := CASE WHEN old_row IS NULL THEN NULL ELSE jsonb_build_object(
        'name', old_row->>'name', 'position', old_row->>'position'
      ) END;
      new_state := CASE WHEN new_row IS NULL THEN NULL ELSE jsonb_build_object(
        'name', new_row->>'name', 'position', new_row->>'position'
      ) END;
      IF TG_OP <> 'UPDATE' OR old_state IS DISTINCT FROM new_state THEN
        event_kind := CASE WHEN TG_OP = 'INSERT' THEN 'stage_added'
          WHEN TG_OP = 'DELETE' THEN 'stage_removed' ELSE 'stage_changed' END;
        event_summary := CASE WHEN TG_OP = 'INSERT'
          THEN 'Stage added: ' || (new_row->>'name')
          WHEN TG_OP = 'DELETE'
          THEN 'Stage removed: ' || (old_row->>'name')
          ELSE 'Stage updated: ' || (new_row->>'name') END;
        INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
          entity_id, summary, before_state, after_state)
        VALUES(project, actor, event_kind, 'stage', entity, event_summary,
          old_state, new_state);
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
