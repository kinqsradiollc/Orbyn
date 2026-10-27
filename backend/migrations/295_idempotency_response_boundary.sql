-- Upgrade every receipt to a non-reexecuting tombstone before permitting new
-- responses. Legacy bodies may contain credentials: never preserve them, even
-- on routes now supported. Keys/status/timestamps retain duplicate protection.
ALTER TABLE idempotency_keys ADD COLUMN request_hash text;
ALTER TABLE idempotency_keys ADD COLUMN original_scope jsonb;
UPDATE idempotency_keys SET body = NULL;

-- Old API writers omit request_hash. Fence those writers at storage, including
-- an old writer repurposing an upgraded row for credential issuance. This does
-- not upgrade old replay readers: drain all old API instances before reopening
-- keyed traffic. Backups/WAL predating the purge still require operator handling.
CREATE FUNCTION fence_idempotency_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The current writer records scope once inside its locked mutation
  -- transaction. Completion, old writers and retries cannot replace it.
  IF TG_OP = 'UPDATE' AND OLD.original_scope IS NOT NULL THEN
    NEW.original_scope := OLD.original_scope;
  END IF;
  IF TG_OP = 'UPDATE' AND
    (NEW.method IS DISTINCT FROM OLD.method OR NEW.path IS DISTINCT FROM OLD.path)
  THEN
    NEW.request_hash := NULL;
  END IF;
  IF NEW.request_hash IS NULL OR
    (NEW.method = 'PUT' AND NEW.path ~ '^/docs/[0-9a-fA-F-]{36}(/content)?$'
      AND NEW.original_scope IS NULL) OR NOT (
    (NEW.method = 'POST' AND NEW.path IN
      ('/items', '/docs', '/projects', '/teams', '/views', '/capture', '/planner/habits'))
    OR (NEW.method IN ('PUT', 'DELETE') AND
      NEW.path ~ '^/items/[0-9a-fA-F-]{36}$')
    OR (NEW.method = 'POST' AND
      NEW.path ~ '^/items/[0-9a-fA-F-]{36}/updates$')
    OR (NEW.method = 'POST' AND
      NEW.path ~ '^/projects/[0-9a-fA-F-]{36}/links$')
    OR (NEW.method = 'PUT' AND NEW.path ~ '^/docs/[0-9a-fA-F-]{36}(/content)?$')
    OR (NEW.method IN ('PUT', 'DELETE') AND
      NEW.path ~ '^/planner/habits/[0-9a-fA-F-]{36}$')
    OR (NEW.method = 'POST' AND
      NEW.path ~ '^/bookings/[0-9a-fA-F-]{36}/(approve|decline|cancel|reschedule)$')
    OR (NEW.method = 'PUT' AND
      NEW.path ~ '^/bookings/[0-9a-fA-F-]{36}/(note|no-show)$')
    OR (NEW.method = 'POST' AND
      NEW.path ~ '^/(me/import|imports/pages)#[0-9a-f]{64}$')
  ) THEN
    NEW.body := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER idempotency_response_boundary
  BEFORE INSERT OR UPDATE ON idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION fence_idempotency_response();
