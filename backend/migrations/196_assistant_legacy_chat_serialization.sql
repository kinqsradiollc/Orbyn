-- Retain every transcript and apply receipt. Stop surplus legacy active jobs
-- through the durable runner's cancellation path so they cannot apply later.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY user_id, chat_id
    ORDER BY (apply_result IS NOT NULL) DESC, created_at, id
  ) AS position
  FROM ai_jobs WHERE chat_id IS NOT NULL AND state IN ('queued','running','waiting')
)
UPDATE ai_jobs j SET cancel_requested=true,
  state=CASE
    WHEN j.run_state IS NULL THEN 'failed'
    WHEN j.state='waiting' THEN 'queued'
    ELSE j.state END,
  error_status=CASE WHEN j.run_state IS NULL THEN 409 ELSE j.error_status END,
  error_message=CASE WHEN j.run_state IS NULL THEN 'This older concurrent run was superseded. Its saved history and changes are retained.' ELSE j.error_message END
FROM ranked r WHERE j.id=r.id AND r.position>1;
