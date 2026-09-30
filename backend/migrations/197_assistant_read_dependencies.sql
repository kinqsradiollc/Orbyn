-- Persist source identity independently of disposable execution checkpoints.
ALTER TABLE ai_jobs ADD COLUMN sources_checked boolean NOT NULL DEFAULT false;
CREATE TABLE assistant_job_sources (
  job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('task','doc','project','record','goal','routine','habit','exam','team','calendar')),
  source_id uuid NOT NULL,
  PRIMARY KEY(job_id,source_kind,source_id)
);

CREATE TABLE assistant_chat_sources (
  chat_id uuid NOT NULL REFERENCES ai_chats ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('task','doc','project','record','goal','routine','habit','exam','team','calendar')),
  source_id uuid NOT NULL,
  PRIMARY KEY(chat_id,turn_id,source_kind,source_id)
);
