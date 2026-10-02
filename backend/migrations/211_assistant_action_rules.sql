-- Extend the existing stable named-assistant ownership; do not replace Memory,
-- schedules, appearance, grant trust or source permissions.
ALTER TABLE agent_grants ADD COLUMN assistant_rules jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(assistant_rules) = 'array' AND jsonb_array_length(assistant_rules) <= 100);
ALTER TABLE agent_grants ADD COLUMN assistant_rules_revision integer NOT NULL DEFAULT 1
  CHECK (assistant_rules_revision > 0);
ALTER TABLE agent_grants ADD CONSTRAINT assistant_rules_builtin_only
  CHECK (kind = 'assistant' OR (assistant_rules = '[]'::jsonb AND assistant_rules_revision = 1));
