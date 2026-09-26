-- Signing in with Orbyn (OAuth) for outside agents, consent and team control
-- (phase A2). Safe to run again.

-- Re-authentication: when this session last proved its password (with
-- two-step when it's on) or a passkey. Granting an agent write access, or
-- bookings, needs it within the last 10 minutes.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reauthenticated_at timestamptz;

-- A refresh token's family (one sign-in and every token rotated from it)
-- lasts at most this long: 90 days from the sign-in, and never past the
-- connection's own end.
ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS family_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS agent_tokens_family_idx
  ON agent_tokens (family) WHERE family IS NOT NULL;

-- When an OAuth connection first finished signing in (its code was
-- exchanged). One that never does isn't listed, and is cleared after a day.
ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS authorized_at timestamptz;
UPDATE agent_grants SET authorized_at = created_at
 WHERE kind <> 'oauth' AND authorized_at IS NULL;

-- One live OAuth connection per person per app: signing in again from the
-- same app updates it (so its activity stays together) instead of adding
-- another.
CREATE UNIQUE INDEX IF NOT EXISTS agent_grants_oauth_client_idx
  ON agent_grants (user_id, client_id)
  WHERE kind = 'oauth' AND revoked_at IS NULL;

-- Apps that registered themselves (DCR): where from (a hash of the address,
-- never the address), for the per-address daily cap across every copy.
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS registered_from text;
CREATE INDEX IF NOT EXISTS oauth_clients_registered_idx
  ON oauth_clients (registered_from, created_at) WHERE kind = 'dcr';

-- The first time any outside agent used a team's data, so its owners and
-- admins are told once.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS agent_first_used_at timestamptz;

-- Leaving a team, being removed, or the team being deleted takes the team
-- off every one of that person's agent connections. Joining again doesn't
-- give it back: the person chooses again.
CREATE OR REPLACE FUNCTION drop_team_from_agent_grants() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agent_grants SET team_ids = array_remove(team_ids, OLD.team_id)
   WHERE user_id = OLD.user_id AND team_ids @> ARRAY[OLD.team_id];
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS team_members_agent_grants ON team_members;
CREATE TRIGGER team_members_agent_grants AFTER DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION drop_team_from_agent_grants();

-- Teams people already left keep no place on their connections.
UPDATE agent_grants g
   SET team_ids = coalesce((
     SELECT array_agg(t ORDER BY t) FROM unnest(g.team_ids) t
      WHERE EXISTS (SELECT 1 FROM team_members m
                     WHERE m.team_id = t AND m.user_id = g.user_id)), '{}')
 WHERE g.team_ids IS NOT NULL AND cardinality(g.team_ids) > 0
   AND EXISTS (SELECT 1 FROM unnest(g.team_ids) t
                WHERE NOT EXISTS (SELECT 1 FROM team_members m
                                   WHERE m.team_id = t AND m.user_id = g.user_id));

-- Notices about outside agents: a new connection, one paused or cut off
-- for safety, and a team's first use. Later migrations that redefine this
-- list must keep 'agent'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('reminder', 'conflict', 'booking', 'rollforward', 'at_risk',
    'deadline', 'rsvp', 'invite', 'booker_reminder', 'mention', 'template', 'ask',
    'promise', 'calendar', 'import', 'agent'));
