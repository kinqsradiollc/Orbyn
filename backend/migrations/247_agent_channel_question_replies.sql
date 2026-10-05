-- Authority is minted only when the exact bounded question card commits sent.
ALTER TABLE agent_channel_outbox
 ADD COLUMN reply_question_digest text CHECK(reply_question_digest IS NULL OR length(reply_question_digest)=64),
 ADD COLUMN reply_expires_at timestamptz,
 ADD COLUMN reply_thread_enabled boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT agent_channel_reply_card CHECK((reply_question_digest IS NULL)=(reply_expires_at IS NULL));
CREATE TABLE agent_channel_reply_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 outbox_id uuid NOT NULL UNIQUE REFERENCES agent_channel_outbox(id) ON DELETE CASCADE,
 request_digest text NOT NULL UNIQUE CHECK(length(request_digest)=64),
 config_hash text NOT NULL CHECK(length(config_hash)=64),
 reply_encrypted text,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','accepted','refused')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 claim_id uuid,
 lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='processing')=(claim_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((state IN ('queued','processing'))=(reply_encrypted IS NOT NULL))
);
CREATE INDEX agent_channel_reply_queue ON agent_channel_reply_receipts(available_at,created_at) WHERE state='queued';
