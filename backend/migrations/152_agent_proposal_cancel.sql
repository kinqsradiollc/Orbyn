-- The Review inbox (A3), continued: an agent's pending proposals never
-- outlive the access they were made with. Safe to run again.
--
-- - Ending a connection (revoked by its person, by an admin, or when an old
--   API key is deleted) cancels what it proposed and is still waiting.
-- - Leaving or being removed from a team cancels the person's pending agent
--   proposals that touch that team.
-- (A team turning agents off, or down to reading, cancels its proposals in
-- PUT /teams/:id/agent-access, which also tells open apps.)

CREATE OR REPLACE FUNCTION cancel_grant_proposals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE proposals SET status = 'cancelled', decided_at = now()
   WHERE grant_id = NEW.id AND source = 'agent' AND status = 'pending';
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS agent_grants_cancel_proposals ON agent_grants;
CREATE TRIGGER agent_grants_cancel_proposals
  AFTER UPDATE OF revoked_at ON agent_grants
  FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION cancel_grant_proposals();

CREATE OR REPLACE FUNCTION cancel_member_proposals() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE proposals SET status = 'cancelled', decided_at = now()
   WHERE user_id = OLD.user_id AND source = 'agent' AND status = 'pending'
     AND OLD.team_id = ANY (team_ids);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS team_members_cancel_proposals ON team_members;
CREATE TRIGGER team_members_cancel_proposals
  AFTER DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION cancel_member_proposals();

-- "via <agent>" in page history and project timelines: which connection
-- made each kept version or activity row, looked up by grant.
CREATE INDEX IF NOT EXISTS doc_versions_via_grant_idx
  ON doc_versions (via_grant_id) WHERE via_grant_id IS NOT NULL;
