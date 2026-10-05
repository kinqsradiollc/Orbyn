-- Morning page generation and email opt-in never grant private plan usage.
-- Permission binds the reviewed account/device/model and explicit fallback choice.
CREATE TABLE agenda_private_permissions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 9007199254740991),
  provider_choice jsonb,
  model text,
  preference_version bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT enabled OR (
    provider_choice IS NOT NULL AND jsonb_typeof(provider_choice)='object'
    AND model IS NOT NULL AND length(model) BETWEEN 1 AND 200
    AND preference_version IS NOT NULL AND preference_version BETWEEN 0 AND 9007199254740991
  ))
);
