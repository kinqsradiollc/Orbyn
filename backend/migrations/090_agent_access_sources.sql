-- Outside agents, continued: where a task's text came from, and ended
-- connections that stay ended. Safe to run again.

-- Tasks whose text came from outside Orbyn, so agents are told and the text
-- is fenced (or left out when a connection hides outside content): today a
-- task sent in by email. Booking events are recognised from bookings.item_ids.
CREATE TABLE IF NOT EXISTS item_sources (
  item_id    uuid PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  source     text NOT NULL CHECK (source IN ('inbound_email')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Finding the booking behind an event (bookings.item_ids @> ARRAY[id]).
CREATE INDEX IF NOT EXISTS bookings_item_ids_idx ON bookings USING gin (item_ids);

-- Deleting a personal API key ends its legacy agent connection, but the
-- connection itself is kept (as every ended connection is): its activity,
-- and the project timelines and page history that name it, stay.
ALTER TABLE agent_grants DROP CONSTRAINT IF EXISTS agent_grants_api_key_id_fkey;
ALTER TABLE agent_grants ADD CONSTRAINT agent_grants_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION end_legacy_agent_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_grants SET revoked_at = now()
   WHERE api_key_id = OLD.id AND revoked_at IS NULL;
  DELETE FROM agent_tokens t USING agent_grants g
   WHERE g.api_key_id = OLD.id AND t.grant_id = g.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS api_keys_end_agent_grant ON api_keys;
CREATE TRIGGER api_keys_end_agent_grant BEFORE DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION end_legacy_agent_grant();

-- Leaving a team (or the team being deleted) takes it off every agent
-- connection that named it, so joining again never quietly reopens it to
-- an agent: the person adds it back in Settings if they want to.
CREATE OR REPLACE FUNCTION prune_agent_grant_team() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_grants SET team_ids = array_remove(team_ids, OLD.team_id)
   WHERE user_id = OLD.user_id AND team_ids IS NOT NULL
     AND OLD.team_id = ANY (team_ids);
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS team_members_prune_agent_grants ON team_members;
CREATE TRIGGER team_members_prune_agent_grants AFTER DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION prune_agent_grant_team();
