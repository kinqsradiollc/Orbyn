import type { FastifyPluginAsync } from "fastify";
import { OAUTH_SCOPES } from "@orbyn/core";
import { env, oauthIssuer } from "../../config/env.js";
import {
  connectorResources,
  type ConnectorResources,
} from "../oauth/resources.js";

/** RFC 9728 discovery location, derived only from the configured recipient. */
export function pluginMetadataUrl(
  resources: ConnectorResources,
): string | undefined {
  if (!connectorResources(resources).some((r) => r.kind === "plugin"))
    return undefined;
  const url = new URL(resources.plugin!);
  url.pathname = `/.well-known/oauth-protected-resource${url.pathname === "/" ? "" : url.pathname}`;
  return url.href;
}

/** Public discovery has its own encapsulation, outside credential hooks. */
export const pluginDiscoveryRoutes: FastifyPluginAsync = async (app) => {
  const resources = { mcp: env.MCP_PUBLIC_URL, plugin: env.PLUGIN_PUBLIC_URL };
  const location = pluginMetadataUrl(resources);
  if (!location) return;
  const issuer = oauthIssuer();
  app.get(new URL(location).pathname, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return {
      resource: resources.plugin,
      authorization_servers: [issuer],
      scopes_supported: [...OAUTH_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "Orbyn plugin integration",
    };
  });
};
