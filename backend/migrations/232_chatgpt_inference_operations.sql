ALTER TABLE ai_jobs ADD COLUMN private_inference_legacy boolean NOT NULL DEFAULT false;
UPDATE ai_jobs SET private_inference_legacy=true
WHERE EXISTS(SELECT 1 FROM chatgpt_inference_requests r WHERE r.job_id=ai_jobs.id);
UPDATE chatgpt_inference_requests SET state='cancelled',payload_encrypted=''
WHERE state IN ('queued','claimed');
DROP INDEX chatgpt_inference_job_active;
CREATE TABLE chatgpt_inference_operations (
 job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id uuid UNIQUE REFERENCES chatgpt_inference_requests(id) ON DELETE SET NULL,
 state text NOT NULL CHECK(state IN ('assigned','fallback_started')),
 fallback_result_encrypted text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,operation_id)
);
CREATE INDEX chatgpt_inference_operations_owner ON chatgpt_inference_operations(user_id,job_id);
-- Operation tombstones outlive expired encrypted envelopes and follow job retention.
