import type { ConnectorResources } from "../oauth/resources.js";
import { pluginInferenceInput } from "./inference-contract.js";
import { enqueuePluginAi, readPluginAiEvents } from "./inference-broker.js";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { settings } from "../../lib/settings.js";
import { registry } from "../../capabilities/index.js";
import { Limiter } from "../mcp-server/limits.js";
import { CapabilityError, describe } from "../../capabilities/registry.js";
import type { Principal } from "../../capabilities/policy.js";
import type { LiveSettings } from "../../lib/settings.js";
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
  pluginToolUiMeta,
  PLUGIN_ENTRYPOINT,
  PLUGIN_MARKDOWN_FILE,
  pluginEntrypointResult,
  pluginEntrypointTool,
  pluginMarkdownFileInput,
  pluginMarkdownFileResult,
  pluginMarkdownFileTool,
  readPluginResource,
} from "./ui-resources.js";
import {
  PLUGIN_MENTIONS,
  pluginMentionInput,
  pluginMentionTool,
  searchPluginMentions,
} from "./mentions.js";
import { pluginRead, pluginWrite } from "./execute.js";
import {
  trackPluginImport,
  readPluginImportEvents,
  importIdFromResult,
  withImportJob,
} from "./import-jobs.js";
import { pluginJobCursorKey } from "./job-cursor.js";
import type { ToolResult } from "../../capabilities/execute.js";
import { pluginLaunch, pluginLaunchInput } from "./launch.js";

const jobQuery = z
  .object({ cursor: z.string().min(1).max(512).optional() })
  .strict();
const jobParams = z.object({ id: z.uuid() }).strict();
function pluginTools(principal: Principal, live: LiveSettings) {
  const allowed = registry.for(principal);
  const tools = allowed.map((cap) => {
    const ui = live.agents.mcp_apps_enabled ? pluginToolUiMeta(cap.name) : null;
    return { ...describe(cap), ...(ui ? { _meta: ui } : {}) };
  });
  if (
    live.agents.mcp_apps_enabled &&
    allowed.some((cap) => cap.name === "get_today")
  )
    tools.push(pluginEntrypointTool);
  if (live.agents.mcp_apps_enabled) {
    tools.push(pluginMarkdownFileTool);
    if (allowed.some((cap) => cap.name === "search"))
      tools.push(pluginMentionTool);
  }
  return tools;
}
async function openPluginSurface(
  principal: Principal,
  live: LiveSettings,
  name: string,
  args: Record<string, unknown>,
  limiter: Limiter,
) {
  if (!pluginTools(principal, live).some((tool) => tool.name === name))
    throw new PluginCallError(403, {
      error: "FORBIDDEN",
      message: "This entrypoint is unavailable to this connection.",
    });
  if (name === PLUGIN_ENTRYPOINT && Object.keys(args).length)
    throw new PluginCallError(400, {
      error: "INVALID",
      message: "This entrypoint takes no arguments.",
    });
  if (
    name === PLUGIN_MARKDOWN_FILE &&
    !pluginMarkdownFileInput.safeParse(args).success
  )
    throw new PluginCallError(400, {
      error: "INVALID",
      message: "Open a Markdown file supplied by the host.",
    });
  const slot = await limiter.take(
    principal.grant_id!,
    principal.user.id,
    "call",
    live.agents.agent_limits,
  );
  if (!slot.ok)
    throw new PluginCallError(
      429,
      { error: "LIMITED", message: slot.reason },
      slot.retryAfter,
    );
  try {
    return name === PLUGIN_ENTRYPOINT
      ? pluginEntrypointResult(args)
      : pluginMarkdownFileResult();
  } finally {
    slot.release();
  }
}
async function mentionSearch(
  request: FastifyRequest,
  args: Record<string, unknown>,
  limiter: Limiter,
  resources: ConnectorResources,
): Promise<ToolResult> {
  const live = await settings();
  const principal = request.pluginCaller!.principal;
  if (
    !pluginTools(principal, live).some((tool) => tool.name === PLUGIN_MENTIONS)
  )
    throw new PluginCallError(403, {
      error: "FORBIDDEN",
      message: "Mentions are unavailable to this connection.",
    });
  const input = pluginMentionInput.safeParse(args);
  if (!input.success)
    throw new PluginCallError(400, {
      error: "INVALID",
      message: "Send a search query of up to 200 characters.",
    });
  const slot = await limiter.take(
    principal.grant_id!,
    principal.user.id,
    "search",
    live.agents.agent_limits,
  );
  if (!slot.ok)
    throw new PluginCallError(
      429,
      { error: "LIMITED", message: slot.reason },
      slot.retryAfter,
    );
  try {
    return await pluginRead(principal, request.headers, live, resources, (db) =>
      searchPluginMentions(db, principal, input.data.query),
    );
  } catch (error) {
    if (error instanceof CapabilityError)
      throw new PluginCallError(403, {
        error: "FORBIDDEN",
        message: "This connection is no longer permitted.",
      });
    throw error;
  } finally {
    slot.release();
  }
}
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
  kind: z.enum(["plugin", "mcp"]),
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
type IntegrationRouteOptions = { recipient?: "mcp" | "plugin" };
export const pluginRoutes: FastifyPluginAsync<IntegrationRouteOptions> = async (
  app,
  options,
) => {
  const kind = options.recipient ?? "plugin";
  const route = (suffix = "") => `/${kind}${suffix}`;
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
  const resource = kind === "plugin" ? resources.plugin : resources.mcp;
  const metadataUrl =
    kind === "plugin"
      ? pluginMetadataUrl(resources)
      : new URL("/.well-known/oauth-protected-resource/mcp", resources.mcp)
          .href;
  app.addHook("preHandler", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!resource) return reply.code(404).send({ error: "NOT_FOUND" });
    try {
      // Resolve for every call, without cookies, session fallback or host metadata.
      const caller = await resolvePluginCaller(
        request.headers,
        await settings(),
        resources,
        undefined,
        kind,
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
  app.post(
    route("/inference"),
    { bodyLimit: 65536 },
    async (request, reply) => {
      if (kind === "mcp" && env.MCP_WORKSPACE_AI_ENABLED !== "true")
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Workspace AI is disabled for this connection.",
        });
      const input = pluginInferenceInput.safeParse(request.body);
      if (!input.success || Object.keys(request.query as object).length)
        return reply.code(400).send({
          error: "INVALID",
          message: "Use a new operation ID and bounded text only.",
        });
      const live = await settings();
      const p = request.pluginCaller!.principal;
      const slot = await limiter.take(
        p.grant_id!,
        p.user.id,
        "heavy",
        live.agents.agent_limits,
      );
      if (!slot.ok)
        return reply
          .header("Retry-After", String(slot.retryAfter))
          .code(429)
          .send({ error: "LIMITED", message: slot.reason });
      try {
        if (live.maintenance.enabled)
          throw new PluginCallError(403, {
            error: "READ_ONLY",
            message: "Workspace AI is paused.",
          });
        const result = await pluginWrite(
          p,
          request.headers,
          live,
          resources,
          (db) =>
            enqueuePluginAi(
              db,
              p,
              String(request.headers.authorization),
              input.data,
            ),
        );
        return reply.code(202).send(result);
      } catch (error) {
        return jobRefusal(error, reply);
      } finally {
        slot.release();
      }
    },
  );
  app.get(route("/inference/:id/events"), async (request, reply) => {
    const params = jobParams.safeParse(request.params),
      query = jobQuery.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({
        error: "INVALID",
        message: "Use a valid request and reconnect cursor.",
      });
    const live = await settings(),
      p = request.pluginCaller!.principal;
    const slot = await limiter.take(
      p.grant_id!,
      p.user.id,
      "call",
      live.agents.agent_limits,
    );
    if (!slot.ok)
      return reply
        .header("Retry-After", String(slot.retryAfter))
        .code(429)
        .send({ error: "LIMITED", message: slot.reason });
    try {
      const key = await pluginJobCursorKey();
      return await pluginRead(p, request.headers, live, resources, (db) =>
        readPluginAiEvents(
          db,
          p,
          params.data.id,
          resource!,
          key,
          query.data.cursor,
        ),
      );
    } catch (error) {
      return jobRefusal(error, reply);
    } finally {
      slot.release();
    }
  });

  async function trackResult(request: FastifyRequest, result: ToolResult) {
    const importId = importIdFromResult(result);
    if (!importId) return undefined;
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
          readPluginImportEvents(db, principal, id, resource!, key, cursor),
      );
    } finally {
      slot.release();
    }
  }
  app.get(route("/connection"), async (request) => {
    const { principal: p, expiresAt } = request.pluginCaller!;
    return connection.parse({
      kind,
      user: { id: p.user.id, name: p.user.name },
      grant_id: p.grant_id,
      client: p.client,
      access: p.access,
      personal: p.personal,
      teams: p.teams,
      expires_at: expiresAt.toISOString(),
    });
  });
  app.get(route("/tools"), async (request, reply) => {
    if (Object.keys(request.query as object).length)
      return reply.code(400).send({
        error: "INVALID",
        message: "This route takes no query parameters.",
      });
    const live = await settings();
    return { tools: pluginTools(request.pluginCaller!.principal, live) };
  });
  app.post(route("/launch"), { bodyLimit: 2048 }, async (request, reply) => {
    const input = pluginLaunchInput.safeParse(request.body);
    if (!input.success || Object.keys(request.query as object).length)
      return reply.code(400).send({
        error: "INVALID",
        message:
          "Send a versioned plugin launch context with presentation hints only.",
      });
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
      return reply
        .header("Retry-After", String(slot.retryAfter))
        .code(429)
        .send({
          error: "LIMITED",
          message: slot.reason,
        });
    }
    try {
      return await pluginRead(
        principal,
        request.headers,
        live,
        resources,
        async () =>
          pluginLaunch(
            principal,
            input.data,
            registry.for(principal).map((cap) => cap.name),
            live.agents.mcp_apps_enabled,
          ),
      );
    } catch (error) {
      return jobRefusal(error, reply);
    } finally {
      slot.release();
    }
  });
  app.post(
    route("/jobs/imports"),
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
  app.get(route("/jobs/:id/events"), async (request, reply) => {
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
  app.get(route("/resources"), async (request, reply) => {
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
    route("/resources/read"),
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
  if (kind === "plugin")
    app.route({
      url: route(),
      method: ["GET", "POST", "DELETE"],
      bodyLimit: 65_536,
      handler: async (request, reply) => {
        const live = await settings();
        const principal = request.pluginCaller!.principal;
        const tools = pluginTools(principal, live);
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
              if (name === PLUGIN_MENTIONS)
                return mentionSearch(request, args, limiter, resources);
              if (name === PLUGIN_ENTRYPOINT || name === PLUGIN_MARKDOWN_FILE)
                return openPluginSurface(principal, live, name, args, limiter);
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
              return withImportJob(result, job);
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
    route("/tools/call"),
    { bodyLimit: 65_536 },
    async (request, reply) => {
      const input = pluginToolInput.safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({
          error: "INVALID",
          message: "Send a tool name and arguments object.",
        });
      try {
        if (input.data.name === PLUGIN_MENTIONS)
          return await mentionSearch(
            request,
            input.data.arguments,
            limiter,
            resources,
          );
        if (
          input.data.name === PLUGIN_ENTRYPOINT ||
          input.data.name === PLUGIN_MARKDOWN_FILE
        )
          return await openPluginSurface(
            request.pluginCaller!.principal,
            await settings(),
            input.data.name,
            input.data.arguments,
            limiter,
          );
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

/** Canonical auxiliary routes, separately encapsulated from legacy recipient authentication. */
export const mcpIntegrationRoutes: FastifyPluginAsync = async (app) => {
  await app.register(pluginRoutes, { recipient: "mcp" });
};
