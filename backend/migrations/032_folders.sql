-- Folders group documents inside a workspace, and favourites pin the few
-- things someone comes back to. Folders are flat on purpose: one level is
-- enough to tidy a workspace without turning it into a filing cabinet.
CREATE TABLE folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id    uuid REFERENCES teams(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A document can sit in a folder; removing the folder leaves it unfiled.
ALTER TABLE docs ADD COLUMN folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;

CREATE TABLE favourites (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'doc' or 'project'.
  kind       text NOT NULL,
  target_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, target_id)
);

CREATE INDEX folders_user_idx ON folders (user_id, position, name);
CREATE INDEX folders_team_idx ON folders (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX docs_folder_idx ON docs (folder_id) WHERE folder_id IS NOT NULL;
