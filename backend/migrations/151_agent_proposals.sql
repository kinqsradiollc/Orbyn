-- The Review inbox (A3): one list of changes waiting for a person's
-- approval, whether the built-in assistant or an outside agent proposed
-- them. Safe to run again.
--
-- A proposal says where it came from (the assistant, or an agent's
-- connection and app), a one-line summary, its state, and when it was
-- decided. Agent proposals carry typed changes across tasks, pages,
-- projects, sessions and links (`changes`, see packages/core/src/review.ts);
-- the assistant's keep their older columns (actions, project,
-- session_change, decision_links) and are read into the same changes for
-- the inbox. The assistant's last 15 minutes, an agent's 72 hours.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'assistant';
DO $$ BEGIN
  ALTER TABLE proposals ADD CONSTRAINT proposals_source_check
    CHECK (source IN ('assistant', 'agent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- The connection that proposed it. Ended connections are kept (a row each),
-- so the name stays; deleting the person deletes both.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS grant_id uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS client_name text NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
DO $$ BEGIN
  ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
    CHECK (status IN ('pending', 'applied', 'declined', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS changes jsonb NOT NULL DEFAULT '[]'::jsonb;
-- The teams its changes touch: a team that turns agents off (or down to
-- reading) cancels its pending agent proposals.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS team_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Applied before this column existed.
UPDATE proposals SET status = 'applied', decided_at = coalesce(decided_at, now())
 WHERE applied AND status = 'pending';

-- Per-source expiry, whoever inserts the row: 15 minutes for the
-- assistant (the column's default), 72 hours for an agent.
CREATE OR REPLACE FUNCTION proposal_expiry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'agent' THEN
    NEW.expires_at := now() + interval '72 hours';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS proposals_expiry ON proposals;
CREATE TRIGGER proposals_expiry BEFORE INSERT ON proposals
  FOR EACH ROW EXECUTE FUNCTION proposal_expiry();

-- The inbox: a person's pending proposals, newest first.
CREATE INDEX IF NOT EXISTS proposals_inbox_idx
  ON proposals (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS proposals_grant_idx
  ON proposals (grant_id) WHERE grant_id IS NOT NULL;

-- A proposal an agent's call made points back at it from the activity log.
CREATE INDEX IF NOT EXISTS agent_activity_proposal_idx
  ON agent_activity (proposal_id) WHERE proposal_id IS NOT NULL;
-- Undo marks the entry it undid.
ALTER TABLE agent_activity ADD COLUMN IF NOT EXISTS undone_at timestamptz;

-- Notices that a change waits for review (ref = "proposal:<id>"). Keeps
-- every kind 093 allowed.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask',
    'promise', 'calendar', 'import', 'project', 'agent', 'review'));
