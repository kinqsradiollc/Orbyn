-- H8: agents start warm.
--
-- 1. Which page is a person's "About me for agents": one per person, an
--    ordinary page in Personal (edited like any other). The page going to
--    the Trash or into a team leaves it unused; making it again points
--    here at the new one.
-- 2. Instructions per space: a few lines for Personal (per person) and for
--    each team (the team's, shared by its members' agents), with who wrote
--    them last and through which agent.
-- 3. When a session was last moved, by whom and through which agent (for
--    "since we last spoke": what the person moved themselves).
--
-- Safe to run again.

CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  doc_id uuid NOT NULL REFERENCES docs ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 2000),
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  updated_via uuid REFERENCES agent_grants ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (team_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_instructions_user_idx
  ON agent_instructions (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agent_instructions_team_idx
  ON agent_instructions (team_id) WHERE team_id IS NOT NULL;

ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS moved_at timestamptz;
ALTER TABLE time_blocks ADD COLUMN IF NOT EXISTS moved_via uuid
  REFERENCES agent_grants(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION time_blocks_moved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  grant_id uuid := nullif(current_setting('orbyn.agent_grant', true), '')::uuid;
BEGIN
  IF NEW.start_at IS DISTINCT FROM OLD.start_at
     OR NEW.end_at IS DISTINCT FROM OLD.end_at THEN
    IF grant_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM agent_grants g WHERE g.id = grant_id) THEN
      grant_id := NULL;
    END IF;
    NEW.moved_at := now();
    NEW.moved_via := grant_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS time_blocks_moved ON time_blocks;
CREATE TRIGGER time_blocks_moved BEFORE UPDATE OF start_at, end_at ON time_blocks
  FOR EACH ROW EXECUTE FUNCTION time_blocks_moved();
CREATE INDEX IF NOT EXISTS time_blocks_moved_idx
  ON time_blocks (user_id, moved_at) WHERE moved_at IS NOT NULL;
