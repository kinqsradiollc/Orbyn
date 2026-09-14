-- Server-generated secrets, such as the key that encrypts AI provider API keys
-- when SECRETS_KEY is not set. Never exposed through the API.
CREATE TABLE IF NOT EXISTS app_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
