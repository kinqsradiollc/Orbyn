import {
  legacyDocStreamRoutes,
  realtimeRoutes,
} from "../modules/realtime/routes.js";
import { mcpListenRoutes } from "../modules/mcp-server/listen.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the realtime process. */
export const realtimeModules = [
  realtimeRoutes,
  legacyDocStreamRoutes,
  // Agents following Orbyn (MCP subscriptions/listen): the gateway sends
  // a POST /mcp whose Mcp-Method is subscriptions/listen here.
  mcpListenRoutes,
];

export const buildRealtimeService = () =>
  createService("realtime", realtimeModules);
