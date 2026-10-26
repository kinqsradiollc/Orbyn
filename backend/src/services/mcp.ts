// MCP service for outside agents: `node dist/services/mcp.js` (Compose `mcp`).
import { buildMcpService } from "./mcp-app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

await startService(await buildMcpService(), env.PORT);
