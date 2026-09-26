import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { settings } from "../../lib/settings.js";
import { SECURITY_POLICY, buildCatalog } from "../../capabilities/catalog.js";
import { INSTRUCTIONS, PROTOCOL_VERSIONS } from "../mcp-server/server.js";

/**
 * The public developer page's data (orbyn.dev/developers/mcp) and the
 * security contact. No sign-in: the catalog is the published description
 * of the MCP server (the same as docs/mcp-catalog.json), with this
 * server's address and its live limits.
 */
export async function developerRoutes(app: FastifyInstance) {
  app.get("/developers/mcp", async (_r, reply) => {
    const s = await settings();
    reply.header("Cache-Control", "public, max-age=300");
    return {
      ...buildCatalog({
        protocol_versions: PROTOCOL_VERSIONS,
        instructions: INSTRUCTIONS,
        mcp_url: env.MCP_PUBLIC_URL,
      }),
      limits: s.agents.agent_limits,
      agents_enabled: s.agents.agents_enabled,
      security: SECURITY_POLICY,
      status_url: `${env.APP_URL.replace(/\/+$/, "")}/status`,
    };
  });

  // RFC 9116. Expires a year from now, so it never reads as stale.
  app.get("/.well-known/security.txt", async (_r, reply) => {
    const base = env.APP_URL.replace(/\/+$/, "");
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Cache-Control", "public, max-age=86400");
    return [
      `Contact: ${env.SECURITY_CONTACT}`,
      `Expires: ${expires}`,
      "Preferred-Languages: en",
      `Policy: ${base}/developers/mcp#security`,
      `Canonical: ${base}/.well-known/security.txt`,
      "",
    ].join("\n");
  });
}
