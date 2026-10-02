-- Preserve source-history access without blocking account/team deletion.
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
  -- Parent rows are already invisible during their ON DELETE cascades. Never
  -- recreate access metadata referencing a removed owner or team, or turn a
  -- removed team's history into Personal history. Ordinary target deletion
  -- still retains metadata while both owning parents exist.
  PERFORM 1 FROM users WHERE id = owner_id FOR KEY SHARE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF owner_team IS NOT NULL THEN
    PERFORM 1 FROM teams WHERE id = owner_team FOR KEY SHARE;
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
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
