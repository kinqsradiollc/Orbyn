-- Plugin import jobs use the existing durable converter, under their own OAuth
-- grant. Events contain status only; result access is rechecked at retrieval.
CREATE TABLE IF NOT EXISTS plugin_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  source_project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  UNIQUE (grant_id, import_id)
);
CREATE INDEX IF NOT EXISTS plugin_import_jobs_import ON plugin_import_jobs(import_id);
CREATE INDEX IF NOT EXISTS plugin_import_jobs_expiry ON plugin_import_jobs(expires_at);

CREATE TABLE IF NOT EXISTS plugin_import_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES plugin_import_jobs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('waiting','queued','reading','ocr','ready','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plugin_import_events_job ON plugin_import_events(job_id, sequence);

CREATE OR REPLACE FUNCTION plugin_import_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status OR OLD.doc_id IS DISTINCT FROM NEW.doc_id THEN
    INSERT INTO plugin_import_events(job_id, status)
      SELECT id, NEW.status FROM plugin_import_jobs
      WHERE import_id=NEW.id AND expires_at > now();
    UPDATE plugin_import_jobs SET expires_at=now()+interval '1 hour'
      WHERE import_id=NEW.id AND expires_at > now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS plugin_import_transition ON imports;
CREATE TRIGGER plugin_import_transition AFTER UPDATE OF status, doc_id ON imports
  FOR EACH ROW EXECUTE FUNCTION plugin_import_transition();
