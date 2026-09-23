-- A change sent with an Idempotency-Key is answered once and remembered for a
-- day: a phone replaying what it did offline, or retrying after a dropped
-- connection, gets the first answer back instead of doing it twice.
CREATE TABLE idempotency_keys (
  -- Whose key: a digest of the credentials it came with, never the token.
  owner text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  -- Null while the first request is still being answered.
  status integer,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, key)
);
CREATE INDEX idempotency_keys_created ON idempotency_keys (created_at);
