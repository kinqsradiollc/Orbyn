-- AI providers managed from the admin console. API keys are encrypted by the
-- application (AES-256-GCM with SECRETS_KEY) before they reach this table, and
-- only a short masked hint is ever shown back.
CREATE TABLE ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Validated by the application so new provider kinds need no migration.
  kind text NOT NULL,
  name varchar(80) NOT NULL,
  base_url text NOT NULL DEFAULT '',
  api_key_encrypted text,
  key_hint text NOT NULL DEFAULT '',
  -- Provider-specific settings such as API version, deployment, or organisation.
  options jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A single row: which provider and model the assistant uses.
CREATE TABLE ai_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider_id uuid REFERENCES ai_providers ON DELETE SET NULL,
  model text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_settings (id) VALUES (true);
