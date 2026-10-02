ALTER TABLE assistant_night_runs DROP CONSTRAINT assistant_night_runs_kind_check;
ALTER TABLE assistant_night_runs ADD CONSTRAINT assistant_night_runs_kind_check
  CHECK (kind IN ('plan','deadlines','study','meetings','tidy','handed','follow_through','goal','routine','reflection'));

-- Keep a link to the original transcript as well as its flattened dependencies.
-- Deleting a source transcript must hide the derived reflection too.
ALTER TABLE assistant_job_sources DROP CONSTRAINT assistant_job_sources_source_kind_check;
ALTER TABLE assistant_job_sources ADD CONSTRAINT assistant_job_sources_source_kind_check
  CHECK(source_kind IN ('task','doc','project','record','goal','routine','habit','exam','team','calendar','chat'));
ALTER TABLE assistant_chat_sources DROP CONSTRAINT assistant_chat_sources_source_kind_check;
ALTER TABLE assistant_chat_sources ADD CONSTRAINT assistant_chat_sources_source_kind_check
  CHECK(source_kind IN ('task','doc','project','record','goal','routine','habit','exam','team','calendar','chat'));

CREATE TABLE assistant_reflection_receipts (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source_kind text NOT NULL CHECK(source_kind IN ('job','task')),
  source_id uuid NOT NULL,
  revision text NOT NULL CHECK(revision ~ '^[a-f0-9]{64}$'),
  reflection_job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE,
  source_chat_id uuid,
  position smallint NOT NULL CHECK(position BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,source_kind,source_id,revision)
);
CREATE INDEX assistant_reflection_receipts_job ON assistant_reflection_receipts(reflection_job_id);
