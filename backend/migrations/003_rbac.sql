-- Role-based access control: system roles, teams with member roles,
-- team-shared items, and an audit log of administrative actions.

ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  ADD COLUMN disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX users_role ON users(role) WHERE role = 'admin';

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user ON team_members(user_id);

-- A team item is visible to every member of the team; user_id records its creator.
ALTER TABLE items ADD COLUMN team_id uuid REFERENCES teams ON DELETE CASCADE;
CREATE INDEX items_team ON items(team_id, created_at DESC, id) WHERE team_id IS NOT NULL;

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created ON audit_log(created_at DESC, id DESC);

-- In-app reminders become one row per recipient so every team member gets one.
UPDATE notifications SET destination = user_id::text WHERE channel = 'inapp';
