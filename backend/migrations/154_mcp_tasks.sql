-- Long jobs for outside agents (A6): the MCP Tasks extension. A client that
-- declares the extension on a call to start_import, or on a large plan, gets
-- a task back instead of waiting; it asks after the task (tasks/get), or
-- hears of it on its subscriptions/listen stream, from any copy of the mcp
-- service, because the task is a row here. Safe to run again.
--
-- - An import's task follows the import itself (imports.status): the row
--   only links the two.
-- - A plan's task holds its result once ready.
-- - Rows go an hour after they were last touched (ttl), by the sweeper.

CREATE TABLE IF NOT EXISTS mcp_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id       uuid NOT NULL REFERENCES agent_grants(id) ON DELETE CASCADE,
  tool           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('plan', 'import')),
  import_id      uuid REFERENCES imports(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'working'
                 CHECK (status IN ('working', 'input_required', 'completed',
                                   'failed', 'cancelled')),
  status_message text,
  -- The finished tool result (content, structuredContent, isError), or the
  -- JSON-RPC error of a failed job.
  result         jsonb,
  error          jsonb,
  -- For an import: the upload link and when it lapses, for the status line.
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ttl_ms         integer NOT NULL DEFAULT 3600000,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);

CREATE INDEX IF NOT EXISTS mcp_tasks_grant ON mcp_tasks (grant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tasks_import ON mcp_tasks (import_id)
  WHERE import_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_tasks_expires ON mcp_tasks (expires_at);
