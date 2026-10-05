-- Prompts/results are encrypted at rest and never contain OpenAI credentials.
CREATE TABLE chatgpt_inference_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
 executor_id uuid NOT NULL REFERENCES chatgpt_executor_enrollments(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES chatgpt_identity_connections(id) ON DELETE CASCADE,
 enrollment_epoch bigint NOT NULL CHECK(enrollment_epoch>0),
 lease_epoch bigint NOT NULL CHECK(lease_epoch>0),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 nonce text NOT NULL CHECK(length(nonce)=43),
 request_hash text NOT NULL CHECK(length(request_hash)=64),
 payload_encrypted text NOT NULL,
 result_encrypted text,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','claimed','completed','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '120 seconds',
 claimed_at timestamptz,
 finished_at timestamptz
);
CREATE UNIQUE INDEX chatgpt_inference_job_active ON chatgpt_inference_requests(job_id) WHERE state IN ('queued','claimed');
CREATE INDEX chatgpt_inference_executor_pending ON chatgpt_inference_requests(executor_id,state,created_at);
CREATE INDEX chatgpt_inference_expiry ON chatgpt_inference_requests(expires_at);
