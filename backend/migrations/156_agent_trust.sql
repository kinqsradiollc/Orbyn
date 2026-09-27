-- Agent 2 (H1): full power and approvals in the chat. How much a
-- connection that may change things does on its own, per connection and
-- per space: 'full' (everything but the ask-first list), 'ask' (asks
-- before every change) or 'suggest' (every change waits in the Review
-- inbox). New connections start at full power. Safe to run again.

ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS trust text NOT NULL DEFAULT 'full';
DO $$ BEGIN
  ALTER TABLE agent_grants ADD CONSTRAINT agent_grants_trust_check
    CHECK (trust IN ('full', 'ask', 'suggest'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Trust per space where it differs from the connection's own:
-- {"personal": "ask", "<team id>": "suggest"}.
ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS space_trust jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Ask-first items the person let this connection do alone
-- (teammates, people, publishing, bookings, team_admin, profile, bulk).
ALTER TABLE agent_grants ADD COLUMN IF NOT EXISTS acts_alone text[] NOT NULL DEFAULT '{}';

-- Existing connections keep their behaviour mapped sensibly: "See and
-- change" becomes full power, "See and suggest" stays suggest only, and
-- "See" stays read-only (its access still says so; trust doesn't widen it).
UPDATE agent_grants SET trust = 'suggest'
 WHERE access = 'suggest' AND trust <> 'suggest';
