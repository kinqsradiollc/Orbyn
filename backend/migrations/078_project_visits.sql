-- A person's project catch-up point follows their account across devices.
-- Keep the prior visit so opening a project does not erase the answer to
-- "what changed since I last looked?" in the same visit.
CREATE TABLE project_visits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  previous_seen_at timestamptz,
  PRIMARY KEY (user_id, project_id)
);
