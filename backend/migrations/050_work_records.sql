-- Promises, decisions, experiments and meeting outcomes share the same links
-- to their source and the work that follows. A record can live in a personal
-- space, a team, or a project within that space.
CREATE TABLE work_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('promise', 'decision', 'experiment', 'meeting_outcome')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 4000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('proposed', 'open', 'done', 'declined', 'superseded')),
  due_at timestamptz,
  review_at timestamptz,
  source_doc_id uuid REFERENCES docs(id) ON DELETE SET NULL,
  source_block_id text CHECK (source_block_id IS NULL OR char_length(source_block_id) BETWEEN 1 AND 64),
  source_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  linked_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  outcome text NOT NULL DEFAULT '' CHECK (char_length(outcome) <= 4000),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_block_id IS NULL OR source_doc_id IS NOT NULL)
);

CREATE INDEX work_records_personal ON work_records (created_by, updated_at DESC)
  WHERE team_id IS NULL;
CREATE INDEX work_records_team ON work_records (team_id, updated_at DESC)
  WHERE team_id IS NOT NULL;
CREATE INDEX work_records_project ON work_records (project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX work_records_owner_due ON work_records (owner_id, due_at)
  WHERE kind = 'promise' AND status IN ('proposed', 'open');
CREATE INDEX work_records_review ON work_records (review_at)
  WHERE kind = 'decision' AND status = 'open';

ALTER TABLE project_activity DROP CONSTRAINT IF EXISTS project_activity_kind_check;
ALTER TABLE project_activity ADD CONSTRAINT project_activity_kind_check
  CHECK (kind IN (
    'project_created', 'project_changed', 'task_added', 'task_changed',
    'task_removed', 'note_added', 'note_changed', 'note_removed',
    'stage_added', 'stage_changed', 'stage_removed',
    'record_added', 'record_changed'
  ));
ALTER TABLE project_activity DROP CONSTRAINT IF EXISTS project_activity_entity_type_check;
ALTER TABLE project_activity ADD CONSTRAINT project_activity_entity_type_check
  CHECK (entity_type IN ('project', 'task', 'note', 'stage', 'record'));

CREATE FUNCTION record_work_record_activity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_state jsonb;
  new_state jsonb;
  actor uuid := nullif(current_setting('orbyn.user_id', true), '')::uuid;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  old_state := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object(
    'kind', OLD.kind, 'title', OLD.title, 'status', OLD.status,
    'due_at', OLD.due_at, 'review_at', OLD.review_at,
    'owner_id', OLD.owner_id, 'linked_item_id', OLD.linked_item_id
  ) END;
  new_state := jsonb_build_object(
    'kind', NEW.kind, 'title', NEW.title, 'status', NEW.status,
    'due_at', NEW.due_at, 'review_at', NEW.review_at,
    'owner_id', NEW.owner_id, 'linked_item_id', NEW.linked_item_id
  );
  IF TG_OP = 'INSERT' OR old_state IS DISTINCT FROM new_state THEN
    INSERT INTO project_activity(project_id, actor_id, kind, entity_type,
      entity_id, summary, before_state, after_state)
    VALUES(NEW.project_id, actor,
      CASE WHEN TG_OP = 'INSERT' THEN 'record_added' ELSE 'record_changed' END,
      'record', NEW.id,
      CASE WHEN NEW.kind = 'promise' THEN 'Promise'
           WHEN NEW.kind = 'decision' THEN 'Decision'
           WHEN NEW.kind = 'experiment' THEN 'Experiment'
           ELSE 'Meeting outcome' END
        || CASE WHEN TG_OP = 'INSERT' THEN ' recorded: ' ELSE ' updated: ' END
        || NEW.title,
      old_state, new_state);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_records_activity AFTER INSERT OR UPDATE ON work_records
  FOR EACH ROW EXECUTE FUNCTION record_work_record_activity();
