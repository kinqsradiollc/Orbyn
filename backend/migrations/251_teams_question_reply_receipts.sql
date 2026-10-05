-- Card proof becomes usable only after a bounded complete question is committed sent.
ALTER TABLE agent_channel_teams_outbox
 ADD COLUMN reply_question_digest text CHECK(reply_question_digest IS NULL OR reply_question_digest ~ '^[a-f0-9]{64}$'),
 ADD COLUMN reply_nonce_hash text CHECK(reply_nonce_hash IS NULL OR reply_nonce_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN reply_expires_at timestamptz,
 ADD CONSTRAINT teams_question_card_binding CHECK(
  (reply_question_digest IS NULL AND reply_nonce_hash IS NULL AND reply_expires_at IS NULL)
  OR (reply_question_digest IS NOT NULL AND reply_nonce_hash IS NOT NULL AND reply_expires_at IS NOT NULL
   AND state='sent' AND source_kind='job' AND event='waiting' AND activity_id IS NOT NULL));
CREATE TABLE agent_channel_teams_reply_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 outbox_id uuid NOT NULL UNIQUE REFERENCES agent_channel_teams_outbox(id) ON DELETE CASCADE,
 request_digest text NOT NULL UNIQUE CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 config_hash text NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
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
CREATE INDEX teams_question_reply_queue ON agent_channel_teams_reply_receipts(available_at,created_at) WHERE state='queued';
