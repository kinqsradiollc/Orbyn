-- Provenance survives clearing a terminal job's checkpoint. New human turns
-- explicitly retain 'person', even in an automation-origin conversation.
ALTER TABLE ai_jobs ADD COLUMN run_origin text NOT NULL DEFAULT 'person';
UPDATE ai_jobs j SET run_origin = coalesce(j.run_state->'request'->'automation'->>'kind',
  CASE WHEN c.origin='reminders' THEN 'person' ELSE c.origin END)
FROM ai_chats c WHERE c.id=j.chat_id AND c.user_id=j.user_id
  AND (j.run_state->'request'->'automation'->>'kind' IS NOT NULL
    OR (j.run_state IS NULL AND c.origin <> 'person'));
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_run_origin_check
  CHECK(run_origin IN ('person','idea','goal','routine','task','night'));

CREATE TABLE assistant_notice_events (
  job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  event text NOT NULL CHECK(event IN ('done','failed','waiting')),
  waiting_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY(job_id,event_key)
);
CREATE INDEX assistant_notice_events_pending_idx ON assistant_notice_events(created_at)
  WHERE resolved_at IS NULL;
