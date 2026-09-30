-- Preserve historical duplicate jobs; identify one canonical retry receipt.
ALTER TABLE ai_jobs ADD COLUMN submission_key uuid;
WITH ranked AS (
 SELECT id, turn_id, row_number() OVER (PARTITION BY user_id, chat_id, turn_id
 ORDER BY (apply_result IS NOT NULL) DESC, created_at, id) AS position
 FROM ai_jobs WHERE chat_id IS NOT NULL AND turn_id IS NOT NULL
)
UPDATE ai_jobs j SET submission_key=r.turn_id FROM ranked r WHERE r.id=j.id AND r.position=1;
CREATE UNIQUE INDEX ai_jobs_submission_identity_idx ON ai_jobs(user_id,chat_id,submission_key)
 WHERE submission_key IS NOT NULL;
