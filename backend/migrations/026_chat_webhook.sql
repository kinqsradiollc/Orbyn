-- Chat delivery: a personal Slack or Discord incoming-webhook URL. The URL is
-- a secret, so it's stored encrypted like other secrets. Null means off.
ALTER TABLE users
  ADD COLUMN chat_webhook_encrypted text,
  ADD COLUMN chat_webhook_kind text CHECK (chat_webhook_kind IN ('slack', 'discord'));
