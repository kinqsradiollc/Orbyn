-- Old assistant chats become a short Agent note before their turns are cleared.
-- Failed compactions can be retried without holding locks during provider calls.
ALTER TABLE ai_chats
  ADD COLUMN IF NOT EXISTS sweep_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sweep_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ai_chats_sweep_claim_idx
  ON ai_chats (sweep_claimed_at, last_used_at)
  WHERE pinned = false AND swept_at IS NULL;
