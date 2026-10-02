-- Curated appearance only; identity, persona and execution authority stay separate.
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS character jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE agent_settings ADD CONSTRAINT agent_character_object CHECK (jsonb_typeof(character) = 'object');
