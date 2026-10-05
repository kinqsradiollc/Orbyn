-- Keep transport terminal states within the ai_jobs state contract.
CREATE OR REPLACE FUNCTION settle_page_inference_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'running' THEN
    UPDATE ai_jobs SET state=CASE WHEN NEW.state='queued' THEN 'queued' ELSE 'failed' END,
      lease_until=NULL,claimed_by=NULL,heartbeat_at=now()
    WHERE maintenance_run_id=NEW.id AND state IN ('queued','running');
  END IF;
  RETURN NEW;
END;
$$;
