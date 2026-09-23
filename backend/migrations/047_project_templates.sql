-- Templates: how a person or a team runs a kind of project — its tasks,
-- estimates, order and brief — saved to start the next one from. Starting
-- one makes a proposal to review; nothing is created until it's approved.
CREATE TABLE project_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who made it; with a team, it belongs to the team.
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  -- A project draft's tasks: id, title, notes, estimate, days from the
  -- start, what each waits on, and a number to reach if it has one.
  tasks jsonb NOT NULL,
  -- The brief made with it: { title, content }.
  page jsonb,
  -- Starts itself on a rhythm ("every other Friday"), as a proposal to review.
  rrule text,
  next_at timestamptz,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_templates_user ON project_templates (user_id);
CREATE INDEX project_templates_team ON project_templates (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX project_templates_due ON project_templates (next_at) WHERE next_at IS NOT NULL;

-- A proposal made from a template, so its notice can open it for review.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template'));
