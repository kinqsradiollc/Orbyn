import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { settings } from "../../lib/settings.js";
import { registry } from "../../capabilities/index.js";
import { execute } from "../../capabilities/execute.js";
import { policy } from "../../capabilities/policy.js";
import { argsDigest } from "../../capabilities/registry.js";
import { pluginWrite } from "./execute.js";
import type { Limiter } from "../mcp-server/limits.js";
import type { ActivityRecorder } from "../mcp-server/recorder.js";
import type { ConnectorResources } from "../oauth/resources.js";
import type { pluginToolInput } from "./tool-input.js";

/** A bounded refusal shared by the plugin HTTP and protocol adapters. */
export class PluginCallError extends Error {
  constructor(
    readonly status: 400 | 403 | 429,
    readonly body: { error: string; message: string },
    readonly retryAfter?: number,
  ) {
    super(body.message);
  }
}

/** Execute with the plugin principal, shared domain receipts, quotas and activity. */
export async function dispatchPluginTool(
  request: FastifyRequest,
  input: z.infer<typeof pluginToolInput>,
  limiter: Limiter,
  recorder: ActivityRecorder,
  resources: ConnectorResources,
) {
  const p = request.pluginCaller!.principal;
  const cap = registry.get(input.name);
  if (!cap || !policy.allows(p, cap))
    throw new PluginCallError(403, {
      error: "FORBIDDEN",
      message: "This tool is not available to this connection.",
    });
  const live = await settings();
  if (
    cap.mode !== "read" &&
    (!live.agents.agents_writes_enabled || live.maintenance.enabled)
  )
    throw new PluginCallError(403, {
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
    throw new PluginCallError(
      429,
      { error: "LIMITED", message: slot.reason },
      slot.retryAfter,
    );
  }
  const started = Date.now();
  try {
    const result = await execute(registry, p, cap.name, input.arguments, {
      primary: true,
      requestId: request.id,
      write: (fn) => pluginWrite(p, request.headers, live, resources, fn),
      log: (error) =>
        request.log.error({ err: error }, "Plugin capability failed"),
    });
    recorder.add({
      userId: p.user.id,
      grantId: p.grant_id!,
      clientName: p.client.name,
      tool: cap.name,
      tier: cap.tier,
      outcome: result.outcome,
      targets: result.targets,
      argsDigest: argsDigest(input.arguments),
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
}
