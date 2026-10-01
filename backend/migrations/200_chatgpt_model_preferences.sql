-- Credential-free preference metadata. Plan tokens remain in the owning runtime.
CREATE TABLE chatgpt_model_preferences (
  connection_id uuid PRIMARY KEY REFERENCES chatgpt_identity_connections(id) ON DELETE CASCADE,
  model text CHECK (model IS NULL OR (length(model) BETWEEN 1 AND 200 AND model !~ '[[:space:][:cntrl:]]')),
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT now()
);
