CREATE TABLE agenda_summary_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 doc_id uuid NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
 local_day date NOT NULL,
 target_block_id text NOT NULL,
 target_hash text NOT NULL,
 snapshot jsonb NOT NULL,
 permission jsonb NOT NULL,
 operation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','waiting','done','failed')),
 lease_token uuid,
 lease_expires_at timestamptz,
 expires_at timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 reason text,
 provider jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,local_day)
);
ALTER TABLE ai_jobs ADD COLUMN agenda_summary_run_id uuid UNIQUE
 REFERENCES agenda_summary_runs(id) ON DELETE CASCADE;
CREATE INDEX agenda_summary_queue ON agenda_summary_runs(next_attempt_at,created_at)
 WHERE state IN ('queued','waiting','running');

CREATE FUNCTION settle_agenda_inference_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'running' THEN
   UPDATE ai_jobs SET state=CASE WHEN NEW.state IN ('queued','waiting') THEN 'queued' ELSE 'failed' END,
     lease_until=NULL,claimed_by=NULL,heartbeat_at=now()
   WHERE agenda_summary_run_id=NEW.id AND state IN ('queued','running');
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER agenda_inference_parent_state AFTER UPDATE OF state ON agenda_summary_runs
 FOR EACH ROW EXECUTE FUNCTION settle_agenda_inference_parent();
