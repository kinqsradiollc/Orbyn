-- One deployment-wide grace period for legacy MCP task_project callers.
-- Re-running migrations or rolling servers back must never extend this deadline.
WITH deployment AS (SELECT clock_timestamp() AS installed_at)
INSERT INTO system_settings (key, value)
SELECT 'mcp_task_project_version_compat', jsonb_build_object(
  'version', 1,
  'installed_at', installed_at,
  'deadline', (installed_at AT TIME ZONE 'UTC' + interval '90 days') AT TIME ZONE 'UTC',
  'legacy_use_count', 0,
  'legacy_last_used_at', NULL
)
FROM deployment
ON CONFLICT (key) DO NOTHING;
