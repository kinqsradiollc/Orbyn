-- Keep the history-access trigger cheap: look activity up by its target through
-- an index, and only run on writes that can change who may see a history target
-- (joining or leaving a project, a new owner or team, or removal). Page autosaves
-- and ordinary task edits no longer touch project_activity or copy the whole row.
CREATE INDEX IF NOT EXISTS project_activity_entity ON project_activity(entity_type, entity_id);

CREATE OR REPLACE FUNCTION remember_project_history_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_type text;
  target_id uuid;
  owner_id uuid;
  owner_team uuid;
  in_project boolean;
BEGIN
  target_type := CASE TG_TABLE_NAME WHEN 'items' THEN 'task'
    WHEN 'docs' THEN 'note' ELSE 'record' END;
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.id;
    owner_team := OLD.team_id;
    in_project := OLD.project_id IS NOT NULL;
    IF TG_TABLE_NAME = 'work_records' THEN owner_id := OLD.created_by;
    ELSE owner_id := OLD.user_id; END IF;
  ELSE
    target_id := NEW.id;
    owner_team := NEW.team_id;
    in_project := NEW.project_id IS NOT NULL
      OR (TG_OP = 'UPDATE' AND OLD.project_id IS NOT NULL);
    IF TG_TABLE_NAME = 'work_records' THEN owner_id := NEW.created_by;
    ELSE owner_id := NEW.user_id; END IF;
  END IF;
  IF in_project OR EXISTS (SELECT 1 FROM project_activity a
      WHERE a.entity_type = target_type AND a.entity_id = target_id) THEN
    INSERT INTO project_history_access(entity_type, entity_id, user_id, team_id)
      VALUES(target_type, target_id, owner_id, owner_team)
      ON CONFLICT (entity_type, entity_id) DO UPDATE
        SET user_id = EXCLUDED.user_id, team_id = EXCLUDED.team_id
        WHERE project_history_access.user_id IS DISTINCT FROM EXCLUDED.user_id
           OR project_history_access.team_id IS DISTINCT FROM EXCLUDED.team_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS items_history_access ON items;
DROP TRIGGER IF EXISTS docs_history_access ON docs;
DROP TRIGGER IF EXISTS records_history_access ON work_records;
DROP TRIGGER IF EXISTS items_history_access_insert ON items;
DROP TRIGGER IF EXISTS items_history_access_update ON items;
DROP TRIGGER IF EXISTS items_history_access_delete ON items;
DROP TRIGGER IF EXISTS docs_history_access_insert ON docs;
DROP TRIGGER IF EXISTS docs_history_access_update ON docs;
DROP TRIGGER IF EXISTS docs_history_access_delete ON docs;
DROP TRIGGER IF EXISTS records_history_access_insert ON work_records;
DROP TRIGGER IF EXISTS records_history_access_update ON work_records;
DROP TRIGGER IF EXISTS records_history_access_delete ON work_records;

-- A brand-new row has no history yet, so only rows created inside a project count.
CREATE TRIGGER items_history_access_insert BEFORE INSERT ON items
  FOR EACH ROW WHEN (NEW.project_id IS NOT NULL)
  EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER items_history_access_update BEFORE UPDATE OF project_id, team_id, user_id ON items
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER items_history_access_delete BEFORE DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION remember_project_history_access();

CREATE TRIGGER docs_history_access_insert BEFORE INSERT ON docs
  FOR EACH ROW WHEN (NEW.project_id IS NOT NULL)
  EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER docs_history_access_update BEFORE UPDATE OF project_id, team_id, user_id ON docs
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER docs_history_access_delete BEFORE DELETE ON docs
  FOR EACH ROW EXECUTE FUNCTION remember_project_history_access();

CREATE TRIGGER records_history_access_insert BEFORE INSERT ON work_records
  FOR EACH ROW WHEN (NEW.project_id IS NOT NULL)
  EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER records_history_access_update BEFORE UPDATE OF project_id, team_id, created_by ON work_records
  FOR EACH ROW WHEN (OLD.project_id IS DISTINCT FROM NEW.project_id
    OR OLD.team_id IS DISTINCT FROM NEW.team_id OR OLD.created_by IS DISTINCT FROM NEW.created_by)
  EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER records_history_access_delete BEFORE DELETE ON work_records
  FOR EACH ROW EXECUTE FUNCTION remember_project_history_access();
