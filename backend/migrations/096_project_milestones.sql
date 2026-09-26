-- Milestones: named, dated checkpoints in a project, kept in their own list.
-- They are not dates on stages: stages are workflow columns that cards move
-- between, so dating them would change a task's target each time a card
-- moved. A task can belong to one milestone of its own project; the
-- milestone rolls up its tasks' planned finish. A milestone never writes a
-- task's deadline. Safe to run again.

CREATE TABLE IF NOT EXISTS project_milestones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- The day it falls on; it is met when its tasks are finished by the end of it.
  due_on      date NOT NULL,
  done_at     timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestones_project
  ON project_milestones (project_id, due_on, created_at);

ALTER TABLE items ADD COLUMN IF NOT EXISTS milestone_id uuid
  REFERENCES project_milestones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS items_milestone ON items (milestone_id)
  WHERE milestone_id IS NOT NULL;

-- A task that leaves its project leaves that project's milestone too, from
-- every write path (moving it, the assistant, agents, imports).
CREATE OR REPLACE FUNCTION items_leave_milestone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.milestone_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project_milestones m
     WHERE m.id = NEW.milestone_id AND m.project_id = NEW.project_id) THEN
    NEW.milestone_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS items_leave_milestone ON items;
CREATE TRIGGER items_leave_milestone BEFORE INSERT OR UPDATE OF project_id, milestone_id ON items
  FOR EACH ROW WHEN (NEW.milestone_id IS NOT NULL)
  EXECUTE FUNCTION items_leave_milestone();
