-- Keep only access metadata when a history target is removed. History may
-- still show its old title, but only to its former owner or current team members.
CREATE TABLE project_history_access (
  entity_type text NOT NULL CHECK (entity_type IN ('task', 'note', 'record')),
  entity_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (entity_type, entity_id)
);

INSERT INTO project_history_access(entity_type, entity_id, user_id, team_id)
SELECT 'task', i.id, i.user_id, i.team_id FROM items i
 WHERE i.project_id IS NOT NULL OR EXISTS (
   SELECT 1 FROM project_activity a WHERE a.entity_type = 'task' AND a.entity_id = i.id)
UNION ALL
SELECT 'note', d.id, d.user_id, d.team_id FROM docs d
 WHERE d.project_id IS NOT NULL OR EXISTS (
   SELECT 1 FROM project_activity a WHERE a.entity_type = 'note' AND a.entity_id = d.id)
UNION ALL
SELECT 'record', w.id, w.created_by, w.team_id FROM work_records w
 WHERE w.project_id IS NOT NULL OR EXISTS (
   SELECT 1 FROM project_activity a WHERE a.entity_type = 'record' AND a.entity_id = w.id);

CREATE FUNCTION remember_project_history_access() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  old_data jsonb;
  target_type text;
  target_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_data := to_jsonb(OLD); END IF;
  row_data := CASE WHEN TG_OP = 'DELETE' THEN old_data ELSE to_jsonb(NEW) END;
  target_type := CASE TG_TABLE_NAME WHEN 'items' THEN 'task'
    WHEN 'docs' THEN 'note' ELSE 'record' END;
  target_id := (row_data->>'id')::uuid;
  IF row_data->>'project_id' IS NOT NULL OR old_data->>'project_id' IS NOT NULL
    OR EXISTS (SELECT 1 FROM project_activity a
      WHERE a.entity_type = target_type AND a.entity_id = target_id) THEN
    INSERT INTO project_history_access(entity_type, entity_id, user_id, team_id)
      VALUES(target_type, target_id,
        (row_data->>CASE WHEN TG_TABLE_NAME = 'work_records' THEN 'created_by' ELSE 'user_id' END)::uuid,
        (row_data->>'team_id')::uuid)
      ON CONFLICT (entity_type, entity_id) DO UPDATE
        SET user_id = EXCLUDED.user_id, team_id = EXCLUDED.team_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER items_history_access BEFORE INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER docs_history_access BEFORE INSERT OR UPDATE OR DELETE ON docs
  FOR EACH ROW EXECUTE FUNCTION remember_project_history_access();
CREATE TRIGGER records_history_access BEFORE INSERT OR UPDATE OR DELETE ON work_records
  FOR EACH ROW EXECUTE FUNCTION remember_project_history_access();
