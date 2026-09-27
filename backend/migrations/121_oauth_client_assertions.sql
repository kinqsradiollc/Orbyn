-- Apps that sign in with a key (private_key_jwt) send a signed assertion
-- with each token request. Each assertion's jti works once: it is kept
-- here (hashed) until the assertion expires, and the sweeper clears it
-- after. Safe to run again.
CREATE TABLE IF NOT EXISTS oauth_client_assertions (
  client_id  text NOT NULL,
  jti_hash   text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (client_id, jti_hash)
);
CREATE INDEX IF NOT EXISTS oauth_client_assertions_expires_idx
  ON oauth_client_assertions (expires_at);
