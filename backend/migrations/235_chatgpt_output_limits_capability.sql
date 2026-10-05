-- Older inference devices remain valid for unbounded calls only.
ALTER TABLE chatgpt_executor_catalogs DROP CONSTRAINT chatgpt_executor_catalogs_capabilities_check;
ALTER TABLE chatgpt_executor_catalogs ADD CONSTRAINT chatgpt_executor_catalogs_capabilities_check
CHECK(jsonb_typeof(capabilities)='array' AND capabilities <@ '["plan_inference_v1","plan_inference_limits_v1"]'::jsonb);
