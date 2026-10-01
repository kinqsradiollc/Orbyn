import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { settings } from "../../lib/settings.js";
import { registry } from "../../capabilities/index.js";
import { describe } from "../../capabilities/registry.js";
import { connectorResources } from "../oauth/resources.js";
import { PluginAuthError, resolvePluginCaller } from "./auth.js";

const connection = z.object({
  kind: z.literal("plugin"),
  user: z.object({ id: z.string(), name: z.string() }),
  grant_id: z.string(),
  client: z.object({ id: z.string(), name: z.string() }),
  access: z.enum(["read", "suggest", "write"]),
  personal: z.boolean(),
  teams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      agent_access: z.string(),
    }),
  ),
  expires_at: z.string(),
});

/** Dedicated plugin HTTP boundary. No browser session or assistant routes are mounted here. */
export const pluginRoutes: FastifyPluginAsync = async (app) => {
  app.decorateRequest("pluginCaller", null);
  // Configuration is server-owned, validated before serving any request.
  const resources = { mcp: env.MCP_PUBLIC_URL, plugin: env.PLUGIN_PUBLIC_URL };
  connectorResources(resources);
  app.addHook("preHandler", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!resources.plugin) return reply.code(404).send({ error: "NOT_FOUND" });
    try {
      // Resolve for every call, without cookies, session fallback or host metadata.
      const caller = await resolvePluginCaller(
        request.headers,
        await settings(),
        resources,
      );
      request.pluginCaller = caller;
    } catch (error) {
      if (!(error instanceof PluginAuthError)) throw error;
      return reply.code(error.status).send({
        error: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        message: error.message,
      });
    }
  });
  app.get("/plugin/connection", async (request) => {
    const { principal: p, expiresAt } = request.pluginCaller!;
    return connection.parse({
      kind: "plugin",
      user: { id: p.user.id, name: p.user.name },
      grant_id: p.grant_id,
      client: p.client,
      access: p.access,
      personal: p.personal,
      teams: p.teams,
      expires_at: expiresAt.toISOString(),
    });
  });
  app.get("/plugin/tools", async (request, reply) => {
    if (Object.keys(request.query as object).length)
      return reply.code(400).send({
        error: "INVALID",
        message: "This route takes no query parameters.",
      });
    return {
      tools: registry.for(request.pluginCaller!.principal).map(describe),
    };
  });
};

declare module "fastify" {
  interface FastifyRequest {
    pluginCaller?: Awaited<ReturnType<typeof resolvePluginCaller>> | null;
  }
}
