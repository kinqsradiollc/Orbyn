import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { settings } from "../../lib/settings.js";
import { registry } from "../../capabilities/index.js";
import { execute } from "../../capabilities/execute.js";
import { policy } from "../../capabilities/policy.js";
import { pluginWrite } from "./execute.js";
import { Limiter } from "../mcp-server/limits.js";
import { describe, argsDigest } from "../../capabilities/registry.js";
import { ActivityRecorder } from "../mcp-server/recorder.js";
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
  const limiter = new Limiter();
  const recorder = new ActivityRecorder();
  recorder.start();
  app.addHook("onClose", async () => {
    recorder.stop();
    await recorder.flush();
  });
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
  app.post(
    "/plugin/tools/call",
    { bodyLimit: 65_536 },
    async (request, reply) => {
      const input = z
        .object({
          name: z.string().min(1).max(128),
          arguments: z.record(z.string(), z.unknown()),
        })
        .strict()
        .safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({
          error: "INVALID",
          message: "Send a tool name and arguments object.",
        });
      const p = request.pluginCaller!.principal;
      const cap = registry.get(input.data.name);
      if (!cap || !policy.allows(p, cap))
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "This tool is not available to this connection.",
        });
      const live = await settings();
      if (
        cap.mode !== "read" &&
        (!live.agents.agents_writes_enabled || live.maintenance.enabled)
      )
        return reply.code(403).send({
          error: "READ_ONLY",
          message: "Changes are paused; reading remains available.",
        });
      const slot = await limiter.take(
        p.grant_id!,
        p.user.id,
        cap.limitGroup === "heavy"
          ? "heavy"
          : cap.mode !== "read"
            ? "write"
            : cap.limitGroup === "search"
              ? "search"
              : "call",
        live.agents.agent_limits,
      );
      if (!slot.ok) {
        recorder.count(p.grant_id!, "limited");
        return reply
          .header("Retry-After", String(slot.retryAfter))
          .code(429)
          .send({ error: "LIMITED", message: slot.reason });
      }
      const started = Date.now();
      try {
        const result = await execute(
          registry,
          p,
          cap.name,
          input.data.arguments,
          {
            primary: true,
            requestId: request.id,
            write: (fn) => pluginWrite(p, request.headers, live, resources, fn),
            log: (error) =>
              request.log.error({ err: error }, "Plugin capability failed"),
          },
        );
        recorder.add({
          userId: p.user.id,
          grantId: p.grant_id!,
          clientName: p.client.name,
          tool: cap.name,
          tier: cap.tier,
          outcome: result.outcome,
          targets: result.targets,
          argsDigest: argsDigest(input.data.arguments),
          summary: cap.title,
          requestId: request.id,
          latencyMs: Date.now() - started,
          write: cap.mode !== "read",
          recorded: result.recorded,
        });
        return result.result;
      } finally {
        slot.release();
      }
    },
  );
};

declare module "fastify" {
  interface FastifyRequest {
    pluginCaller?: Awaited<ReturnType<typeof resolvePluginCaller>> | null;
  }
}
