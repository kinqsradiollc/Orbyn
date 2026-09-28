-- The built-in agent acts through the same grant and capability checks as
-- outside agents, with one private grant per person. Safe to run again.

ALTER TABLE agent_grants DROP CONSTRAINT IF EXISTS agent_grants_kind_check;
ALTER TABLE agent_grants
  ADD CONSTRAINT agent_grants_kind_check
  CHECK (kind IN ('oauth', 'key', 'legacy', 'assistant'));

CREATE UNIQUE INDEX IF NOT EXISTS agent_grants_assistant_user_idx
  ON agent_grants (user_id)
  WHERE kind = 'assistant';

ALTER TABLE agent_grants
  ADD COLUMN IF NOT EXISTS approval_scopes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION assistant_grant_cannot_be_revoked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'assistant' AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'The built-in assistant grant cannot be revoked';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assistant_grant_nonrevocable ON agent_grants;
CREATE TRIGGER assistant_grant_nonrevocable
  BEFORE UPDATE OF revoked_at ON agent_grants
  FOR EACH ROW EXECUTE FUNCTION assistant_grant_cannot_be_revoked();
