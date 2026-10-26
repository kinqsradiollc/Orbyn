import { mcpServerRoutes } from "../modules/mcp-server/routes.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the mcp process. */
export const mcpModules = [mcpServerRoutes];

export const buildMcpService = () => createService("mcp", mcpModules);
