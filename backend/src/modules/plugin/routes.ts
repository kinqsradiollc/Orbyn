import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { settings } from "../../lib/settings.js";
import { registry } from "../../capabilities/index.js";
import { Limiter } from "../mcp-server/limits.js";
import { CapabilityError, describe } from "../../capabilities/registry.js";
import { ActivityRecorder } from "../mcp-server/recorder.js";
import { connectorResources } from "../oauth/resources.js";
import { PluginAuthError, resolvePluginCaller } from "./auth.js";
import { pluginMetadataUrl } from "./discovery.js";
import { pluginToolInput } from "./tool-input.js";
import { dispatchPluginTool, PluginCallError } from "./dispatch.js";
import { servePluginProtocol } from "./protocol.js";
import {
  pluginResourceInput,
  pluginResources,
  readPluginResource,
} from "./ui-resources.js";
import { toolUiMeta } from "../mcp-server/apps.js";
import { pluginRead, pluginWrite } from "./execute.js";
import { trackPluginImport, readPluginImportEvents } from "./import-jobs.js";
import { pluginJobCursorKey } from "./job-cursor.js";
import { pluginJobUri } from "./job-resource.js";
import type { ToolResult } from "../../capabilities/execute.js";

const jobQuery = z
  .object({ cursor: z.string().min(1).max(512).optional() })
  .strict();
const jobParams = z.object({ id: z.uuid() }).strict();
function jobRefusal(error: unknown, reply: FastifyReply) {
  if (error instanceof PluginCallError) {
    if (error.retryAfter) reply.header("Retry-After", String(error.retryAfter));
    return reply.code(error.status).send(error.body);
  }
  if (error instanceof CapabilityError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "INVALID"
          ? 400
          : error.code === "STALE"
            ? 409
            : 403;
    return reply
      .code(status)
      .send({ error: error.code, message: error.message });
  }
  throw error;
}

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
  const metadataUrl = pluginMetadataUrl(resources);
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
      if (error.status === 401 && metadataUrl)
        reply.header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${metadataUrl}"`,
        );
      return reply.code(error.status).send({
        error: error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        message: error.message,
      });
    }
  });
  async function trackResult(request: FastifyRequest, result: ToolResult) {
    const done = result.structuredContent?.done as
      { id?: string }[] | undefined;
    const importId = done?.[0]?.id?.match(/^import:([0-9a-f-]+)$/i)?.[1];
    if (result.isError || !importId) return undefined;
    const live = await settings();
    return pluginWrite(
      request.pluginCaller!.principal,
      request.headers,
      live,
      resources,
      (db) => trackPluginImport(db, request.pluginCaller!.principal, importId),
    );
  }
  async function jobEvents(
    request: FastifyRequest,
    id: string,
    cursor?: string,
  ) {
    const live = await settings();
    const principal = request.pluginCaller!.principal;
    const slot = await limiter.take(
      principal.grant_id!,
      principal.user.id,
      "call",
      live.agents.agent_limits,
    );
    if (!slot.ok) {
      recorder.count(principal.grant_id!, "limited");
      throw new PluginCallError(
        429,
        { error: "LIMITED", message: slot.reason },
        slot.retryAfter,
      );
    }
    try {
      const key = await pluginJobCursorKey();
      return await pluginRead(
        principal,
        request.headers,
        live,
        resources,
        (db) =>
          readPluginImportEvents(
            db,
            principal,
            id,
            resources.plugin!,
            key,
            cursor,
          ),
      );
    } finally {
      slot.release();
    }
  }
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
    const live = await settings();
    return {
      tools: registry.for(request.pluginCaller!.principal).map((cap) => {
        const ui = live.agents.mcp_apps_enabled ? toolUiMeta(cap.name) : null;
        return { ...describe(cap), ...(ui ? { _meta: ui } : {}) };
      }),
    };
  });
  app.post(
    "/plugin/jobs/imports",
    { bodyLimit: 65_536 },
    async (request, reply) => {
      const input = pluginToolInput.safeParse(request.body);
      if (!input.success || input.data.name !== "start_import")
        return reply.code(400).send({
          error: "INVALID",
          message: "Send start_import and its arguments.",
        });
      try {
        const result = await dispatchPluginTool(
          request,
          input.data,
          limiter,
          recorder,
          resources,
        );
        const job = await trackResult(request, result);
        if (!job) return { result };
        return { job, result };
      } catch (error) {
        return jobRefusal(error, reply);
      }
    },
  );
  app.get("/plugin/jobs/:id/events", async (request, reply) => {
    const params = jobParams.safeParse(request.params);
    const query = jobQuery.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({
        error: "INVALID",
        message: "Send one job id and an optional reconnect cursor.",
      });
    try {
      return await jobEvents(request, params.data.id, query.data.cursor);
    } catch (error) {
      return jobRefusal(error, reply);
    }
  });
  app.get("/plugin/resources", async (request, reply) => {
    if (Object.keys(request.query as object).length)
      return reply.code(400).send({
        error: "INVALID",
        message: "This route takes no query parameters.",
      });
    const live = await settings();
    const tools = registry
      .for(request.pluginCaller!.principal)
      .map((cap) => cap.name);
    return { resources: pluginResources(tools, live.agents.mcp_apps_enabled) };
  });
  app.post(
    "/plugin/resources/read",
    { bodyLimit: 1024 },
    async (request, reply) => {
      const input = pluginResourceInput.safeParse(request.body);
      if (!input.success)
        return reply
          .code(400)
          .send({ error: "INVALID", message: "Send one resource identifier." });
      const live = await settings();
      const tools = registry
        .for(request.pluginCaller!.principal)
        .map((cap) => cap.name);
      const resource = readPluginResource(
        input.data.uri,
        tools,
        live.agents.mcp_apps_enabled,
      );
      if (!resource)
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "This resource is not available to this connection.",
        });
      return resource;
    },
  );
  app.route({
    url: "/plugin",
    method: ["GET", "POST", "DELETE"],
    bodyLimit: 65_536,
    handler: async (request, reply) => {
      const live = await settings();
      const principal = request.pluginCaller!.principal;
      const tools = registry.for(principal).map((cap) => {
        const ui = live.agents.mcp_apps_enabled ? toolUiMeta(cap.name) : null;
        return { ...describe(cap), ...(ui ? { _meta: ui } : {}) };
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers))
        if (
          /^(content-type|mcp-protocol-version|mcp-method|mcp-name|mcp-param-.+)$/i.test(
            name,
          ) &&
          typeof value === "string"
        )
          headers.set(name, value);
      headers.set("content-type", "application/json");
      headers.set("accept", "application/json, text/event-stream");
      const webRequest = new Request("http://plugin.local/plugin", {
        method: request.method,
        headers,
        ...(request.method === "POST"
          ? { body: JSON.stringify(request.body) }
          : {}),
      });
      const response = await servePluginProtocol(
        {
          grantId: principal.grant_id!,
          clientId: principal.client.id!,
          tools,
          uiEnabled: live.agents.mcp_apps_enabled,
          invoke: async (name, args) => {
            const result = await dispatchPluginTool(
              request,
              { name, arguments: args },
              limiter,
              recorder,
              resources,
            );
            if (name !== "start_import") return result;
            const job = await trackResult(request, result);
            if (!job) return result;
            return {
              ...result,
              content: [
                ...result.content,
                {
                  type: "resource_link" as const,
                  uri: pluginJobUri(job.id),
                  name: "Import progress",
                  mimeType: "application/json",
                },
              ],
              _meta: {
                ...result._meta,
                "orbyn/importJob": { id: job.id, uri: pluginJobUri(job.id) },
              },
            };
          },
          readJob: (id, cursor) => jobEvents(request, id, cursor),
        },
        webRequest,
        request.body,
      );
      for (const name of [
        "content-type",
        "mcp-protocol-version",
        "retry-after",
        "allow",
      ]) {
        const value = response.headers.get(name);
        if (value) reply.header(name, value);
      }
      return reply.code(response.status).send(await response.text());
    },
  });
  app.post(
    "/plugin/tools/call",
    { bodyLimit: 65_536 },
    async (request, reply) => {
      const input = pluginToolInput.safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({
          error: "INVALID",
          message: "Send a tool name and arguments object.",
        });
      try {
        return await dispatchPluginTool(
          request,
          input.data,
          limiter,
          recorder,
          resources,
        );
      } catch (error) {
        if (!(error instanceof PluginCallError)) throw error;
        if (error.retryAfter)
          reply.header("Retry-After", String(error.retryAfter));
        return reply.code(error.status).send(error.body);
      }
    },
  );
};

declare module "fastify" {
  interface FastifyRequest {
    pluginCaller?: Awaited<ReturnType<typeof resolvePluginCaller>> | null;
  }
}
