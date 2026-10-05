ALTER TABLE ai_jobs ADD COLUMN maintenance_run_id uuid UNIQUE
  REFERENCES assistant_page_runs(id) ON DELETE CASCADE;

-- Parent cancellation and shutdown invalidate the transport immediately. A
-- staged companion is already done and must not be resurrected by requeueing.
CREATE FUNCTION settle_page_inference_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'running' THEN
    UPDATE ai_jobs SET state=CASE WHEN NEW.state='queued' THEN 'queued' ELSE 'failed' END,
      lease_until=NULL,claimed_by=NULL,heartbeat_at=now()
    WHERE maintenance_run_id=NEW.id AND state IN ('queued','running');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER page_inference_parent_state AFTER UPDATE OF state ON assistant_page_runs
  FOR EACH ROW EXECUTE FUNCTION settle_page_inference_parent();
