-- Small set of web resources pinned on Project Home. Project deletion removes
-- them; page and task visibility still follows the existing project boundary.
CREATE TABLE project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX project_links_project_order ON project_links
  (project_id, created_at, id);
