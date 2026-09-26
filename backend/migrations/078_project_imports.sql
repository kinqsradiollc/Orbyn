-- Keep the chosen project and its space with an asynchronous import. The
-- converter checks both again before making the page; the original file still
-- follows the existing short-lived deletion path.
ALTER TABLE imports
  ADD COLUMN project_id uuid,
  ADD COLUMN project_team_id uuid;

CREATE INDEX imports_project_idx ON imports (project_id)
  WHERE project_id IS NOT NULL;
