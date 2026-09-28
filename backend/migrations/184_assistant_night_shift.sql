ALTER TABLE agent_settings ADD COLUMN night_shift jsonb NOT NULL DEFAULT '{}'::jsonb;
