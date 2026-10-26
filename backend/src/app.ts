import type { FastifyPluginAsync } from "fastify";
import { createService } from "./services/http.js";
import { realtimeRoutes } from "./modules/realtime/routes.js";
import { apiModules } from "./services/api-app.js";
import { aiModules } from "./services/ai-app.js";
import { statusModules } from "./services/status-app.js";
import { realtimeModules } from "./services/realtime-app.js";
import { filesModules } from "./services/files-app.js";
import { mcpModules } from "./services/mcp-app.js";
import { pluginModules } from "./services/plugin-app.js";

/** Explicit compatibility registry for combined development and existing callers.
 * Deployed services import their own composition roots instead of this union. */
export const serviceModules: Record<
  "api" | "ai" | "status" | "realtime" | "files" | "mcp" | "plugin",
  FastifyPluginAsync[]
> = {
  api: apiModules,
  ai: aiModules,
  status: statusModules,
  realtime: realtimeModules,
  files: filesModules,
  mcp: mcpModules,
  plugin: pluginModules,
};

export { buildApiService } from "./services/api-app.js";
export { buildAiService } from "./services/ai-app.js";
export { buildStatusService } from "./services/status-app.js";
export { buildRealtimeService } from "./services/realtime-app.js";
export { buildFilesService } from "./services/files-app.js";
export { buildMcpService } from "./services/mcp-app.js";
export { buildPluginService } from "./services/plugin-app.js";

/**
 * First-party and portable MCP modules in one process for tests and local development.
 * Plugin integration remains a separate service. `first`
 * plugins register before the modules (the route inventory test uses one to
 * hook every route as it is added).
 */
export const buildApp = (first: FastifyPluginAsync[] = []) =>
  createService("all", [
    ...first,
    ...serviceModules.api,
    ...serviceModules.ai,
    ...serviceModules.status,
    ...serviceModules.files,
    ...serviceModules.mcp,
    realtimeRoutes,
  ]);
