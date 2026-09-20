-- Projects: a named piece of work with ordered stages, a deadline and the
-- tasks that make it up. Tasks keep living in `items`; a project just groups
-- them, so the planner, calendar and scheduler need no changes.
CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  -- 'active', 'done' or 'archived'.
  status      text NOT NULL DEFAULT 'active',
  deadline    timestamptz,
  -- The project's brief, when one has been written.
  doc_id      uuid REFERENCES docs(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   integer NOT NULL DEFAULT 0
);

-- A task can belong to a project, and to one of its stages. Clearing the
-- project leaves the task in place, unfiled.
ALTER TABLE items ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE items ADD COLUMN stage_id uuid REFERENCES project_stages(id) ON DELETE SET NULL;

CREATE INDEX projects_user_idx ON projects (user_id, updated_at DESC);
CREATE INDEX projects_team_idx ON projects (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX project_stages_project_idx ON project_stages (project_id, position);
CREATE INDEX items_project_idx ON items (project_id) WHERE project_id IS NOT NULL;
