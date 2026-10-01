-- Legacy grants remain portable MCP grants. Plugin authorization must create
-- its own grant even when the same app is already connected through MCP.
ALTER TABLE agent_grants ADD COLUMN resource_kind text NOT NULL DEFAULT 'mcp'
  CHECK (resource_kind IN ('mcp','plugin'));
ALTER TABLE agent_grants ADD CONSTRAINT plugin_grants_require_oauth
  CHECK (resource_kind = 'mcp' OR kind = 'oauth');
DROP INDEX agent_grants_oauth_client_idx;
CREATE UNIQUE INDEX agent_grants_oauth_client_resource_idx
  ON agent_grants(user_id,client_id,resource_kind)
  WHERE kind='oauth' AND revoked_at IS NULL;
