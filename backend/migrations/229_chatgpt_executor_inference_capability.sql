-- Older catalog-only devices remain readable but cannot receive private prompts.
ALTER TABLE chatgpt_executor_catalogs ADD COLUMN capabilities jsonb NOT NULL DEFAULT '[]'::jsonb
CHECK(jsonb_typeof(capabilities)='array' AND capabilities <@ '["plan_inference_v1"]'::jsonb);
