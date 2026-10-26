import { pluginDiscoveryRoutes } from "../modules/plugin/discovery.js";
import {
  pluginRoutes,
  mcpIntegrationRoutes,
} from "../modules/plugin/routes.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the plugin process. */
export const pluginModules = [
  pluginDiscoveryRoutes,
  pluginRoutes,
  mcpIntegrationRoutes,
];

export const buildPluginService = () => createService("plugin", pluginModules);
