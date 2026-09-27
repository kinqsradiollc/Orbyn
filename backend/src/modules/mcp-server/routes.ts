import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { isLegacyRequest } from "@modelcontextprotocol/server";
import { env, oauthIssuer } from "../../config/env.js";
import { transaction } from "../../db/pool.js";
import { mcpOriginAllowed } from "../../lib/mcp-origins.js";
import { actAs } from "../../lib/actor.js";
import {
  agentRequests,
  requestUser,
  routeLabels,
} from "../../lib/request-log.js";
import { settings } from "../../lib/settings.js";
import { registry } from "../../capabilities/index.js";
import {
  McpAuthError,
  SCOPES,
  insufficientScope,
  isChatGpt,
  resolveCaller,
  stepUpScope,
  type Caller,
} from "./auth.js";
import { Limiter, Strikes, type LimitKind } from "./limits.js";
import {
  noticeAgentEvent,
  suspendGrant,
  type SuspendReason,
} from "../agents/service.js";
import { listenAuthChanges } from "../../lib/auth-events.js";
import type { Principal } from "../../capabilities/policy.js";
import { ActivityRecorder } from "./recorder.js";
import { serve, type CallContext } from "./server.js";
import { checkListen, closeAllListens, openListen } from "./listen.js";
import { answerTaskMethod, startTask } from "./task-calls.js";
import { declaresTasks, taskKind, TASK_METHODS } from "./tasks.js";
import { Readable } from "node:stream";
import { serviceOf } from "../../services/http.js";

/**
 * The MCP address (https://mcp.orbyn.dev/mcp, and /api/mcp on the web app
 * for older setups). Stateless: one JSON-RPC message per POST, answered in
 * JSON; no session ids, GET and DELETE are 405, batches are refused.
 *
 * Before the SDK sees a message, in order: the Origin check (a browser page
 * not on the list gets 403), the agents switch (off: 503), the caller
 * (a missing or wrong credential: 401 with a challenge), the message's
 * shape, maintenance mode (reads go on, changes get a JSON-RPC error),
 * and the connection's limits (429 with Retry-After).
 */

/** JSON-RPC error codes: the standard ones, and Orbyn's in the server range. */
export const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Changes are paused for maintenance; reading still works. */
  maintenance: -32000,
  unauthorized: -32001,
  unavailable: -32002,
  forbidden: -32003,
  rateLimited: -32029,
} as const;

type Id = string | number | null;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is Id =>
  typeof v === "string" || typeof v === "number" || v === null;

const rpcError = (
  id: Id,
  code: number,
  message: string,
  data?: Record<string, unknown>,
) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data ? { data } : {}) },
});

/** The long-lived stream: the realtime service's (see listen.ts). */
const LISTEN_METHOD = "subscriptions/listen";

/** Methods named in the request log; any other method is logged as mcp:other. */
const LOGGED_METHODS = new Set([
  "initialize",
  "ping",
  "server/discover",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "prompts/list",
  "prompts/get",
  "completion/complete",
  "logging/setLevel",
  "subscriptions/listen",
  "tasks/get",
  "tasks/cancel",
  "tasks/update",
  "notifications/initialized",
  "notifications/cancelled",
]);

/**
 * The request log's route for a call: a known tool's own name, or a known
 * method; never text the client chose, so a caller can't fill the log with
 * routes of its own.
 */
export function routeLabel(
  method: string,
  toolName: string | null,
  capName: string | undefined,
): string {
  if (method === "tools/call")
    return capName
      ? `mcp:${capName}`
      : toolName
        ? "mcp:unknown-tool"
        : "mcp:tools/call";
  return LOGGED_METHODS.has(method) ? `mcp:${method}` : "mcp:other";
}

/** Headers from the client the SDK needs to see. */
const PASSED =
  /^(content-type|mcp-protocol-version|mcp-method|mcp-name|mcp-param-.+|last-event-id)$/i;

/** A web Request for the SDK, from Fastify's request and its parsed body. */
function webRequest(r: FastifyRequest, body: unknown): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(r.headers))
    if (PASSED.test(name) && typeof value === "string")
      headers.set(name, value);
  headers.set("content-type", "application/json");
  // Answers are always JSON; 2025-era rules want both types accepted, so a
  // client that only says JSON (or nothing) is served the same.
  headers.set("accept", "application/json, text/event-stream");
  return new Request("http://mcp.local/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Every failure on /mcp, framework errors included, as a JSON-RPC error. */
function mcpErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const status = error.statusCode ?? 500;
  const [code, message] =
    status === 429
      ? [ERR.rateLimited, "That's a lot at once. Wait a moment and try again."]
      : status === 413
        ? [ERR.invalidRequest, "That request is too large to send."]
        : status === 415
          ? [ERR.parse, "Send the request as application/json."]
          : status === 400 &&
              (error.code?.startsWith("FST_ERR_CTP") ||
                error instanceof SyntaxError)
            ? [ERR.parse, "That request isn't valid JSON."]
            : status < 500
              ? [ERR.invalidRequest, "That request couldn't be read."]
              : [
                  ERR.internal,
                  "Something went wrong on Orbyn's side. Try again in a moment.",
                ];
  if (status >= 500) request.log.error({ err: error }, "MCP request failed");
  return reply.code(status).send(rpcError(null, code, message));
}

/** 405 for GET and DELETE: nothing is streamed and there are no sessions. */
const notAllowed = async (_r: FastifyRequest, reply: FastifyReply) =>
  reply
    .code(405)
    .header("Allow", "POST")
    .send(
      rpcError(
        null,
        ERR.invalidRequest,
        "This MCP server answers POST requests only.",
      ),
    );

/** RFC 9728 protected-resource metadata for the MCP address. */
function protectedResource() {
  return {
    resource: env.MCP_PUBLIC_URL,
    authorization_servers: [oauthIssuer()],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Orbyn",
  };
}

/** HTTP date for Sunset; @<unix> for Deprecation (RFC 9745). */
const legacyHeaders = (caller: Caller, reply: FastifyReply) => {
  if (!caller.sunset) return;
  const since = new Date(caller.sunset.getTime() - 90 * 86_400_000);
  reply.header("Deprecation", `@${Math.floor(since.getTime() / 1000)}`);
  reply.header("Sunset", caller.sunset.toUTCString());
};

/** How long a connection's reads go to the primary after it changed something. */
const READ_OWN_WRITES_MS = 10_000;

/** This copy's limits and activity log (one per process). */
export const limiter = new Limiter();
export const recorder = new ActivityRecorder();
export const strikes = new Strikes();

/** Refusals that look like probing: asking for what the connection can't reach. */
const probing = (exec: { result: { _meta?: Record<string, unknown> } }) => {
  const code = (exec.result._meta?.["orbyn/error"] as { code?: string })?.code;
  return code === "NOT_FOUND" || code === "FORBIDDEN";
};
/** The last write per connection on this copy (the database has it too). */
const wrote = new Map<string, number>();

/** Teams this copy knows an agent has already used (their owners were told). */
const teamsUsed = new Set<string>();

/**
 * The first time any outside agent uses a team's data, the team's owners
 * and admins are told once (not the person whose agent it is). Off the
 * request path.
 */
export async function noteTeamUse(p: Principal): Promise<void> {
  const fresh = p.teams.filter((t) => !teamsUsed.has(t.id)).map((t) => t.id);
  if (!fresh.length) return;
  await transaction(async (db) => {
    const first = (
      await db.query<{ id: string; name: string }>(
        `UPDATE teams SET agent_first_used_at = now()
          WHERE id = ANY ($1::uuid[]) AND agent_first_used_at IS NULL
          RETURNING id, name`,
        [fresh],
      )
    ).rows;
    for (const team of first) {
      const managers = (
        await db.query<{ user_id: string }>(
          `SELECT user_id FROM team_members
            WHERE team_id = $1 AND role IN ('owner', 'admin') AND user_id <> $2`,
          [team.id, p.user.id],
        )
      ).rows;
      for (const m of managers)
        await noticeAgentEvent(db, m.user_id, {
          ref: `team:${team.id}`,
          title: `An outside agent used ${team.name} for the first time`,
          body: `${p.user.name} connected ${p.client.name}, which can now reach ${team.name}'s tasks, pages and projects as far as ${p.user.name}'s role allows. You can cap or turn off outside agents in ${team.name}'s settings → Outside agents.`,
        });
    }
  });
  for (const id of fresh) teamsUsed.add(id);
}

export async function mcpServerRoutes(app: FastifyInstance) {
  // The dedicated mcp service never holds a stream (the gateway sends
  // listen requests to realtime); in one process (development, tests) the
  // stream is served here.
  const holdsStreams = serviceOf(app) !== "mcp";
  /** Pauses a misbehaving connection (off the request path; audited). */
  const suspend = (grantId: string, reason: SuspendReason) =>
    void suspendGrant(grantId, reason).then(
      (done) => {
        if (done) app.log.warn({ grantId, reason }, "Agent connection paused");
      },
      (err) => app.log.error({ err }, "Pausing an agent connection failed"),
    );

  recorder.start();
  // Hear revocations from every copy (orbyn_auth) while serving.
  let stopListening: (() => Promise<void>) | null = null;
  app.addHook("onReady", async () => {
    stopListening = await listenAuthChanges((err) =>
      app.log.warn({ err }, "Listening for agent access changes failed"),
    );
  });
  app.addHook("preClose", async () => {
    if (holdsStreams) closeAllListens();
  });
  app.addHook("onClose", async () => {
    recorder.stop();
    await recorder.flush();
    await stopListening?.();
  });

  app.post(
    "/mcp",
    // add_file carries a file of up to 25 MB as base64 (H2): about 34 MB.
    { errorHandler: mcpErrorHandler, bodyLimit: 36 * 1024 * 1024 },
    async (r, reply) => {
      agentRequests.add(r);
      routeLabels.set(r, "mcp");

      if (!mcpOriginAllowed(r.headers.origin))
        return reply
          .code(403)
          .send(
            rpcError(
              null,
              ERR.forbidden,
              "Requests from this web page aren't allowed.",
            ),
          );

      const s = await settings();
      if (!s.agents.agents_enabled)
        return reply
          .code(503)
          .header("Retry-After", "300")
          .send(
            rpcError(
              null,
              ERR.unavailable,
              "Outside agents are switched off on this Orbyn for now. Try again later.",
            ),
          );

      let caller: Caller;
      try {
        caller = await resolveCaller(r.headers, s);
      } catch (e) {
        if (!(e instanceof McpAuthError)) throw e;
        if (e.challenge) reply.header("WWW-Authenticate", e.challenge);
        return reply
          .code(e.status)
          .send(
            rpcError(
              null,
              e.status === 401 ? ERR.unauthorized : ERR.forbidden,
              e.message,
            ),
          );
      }
      const p = caller.principal;
      requestUser.set(r, p.user.id);
      legacyHeaders(caller, reply);
      if (p.teams.length)
        void noteTeamUse(p).catch((err) =>
          r.log.error({ err }, "Telling a team about its first agent failed"),
        );

      const body = r.body as unknown;
      if (Array.isArray(body))
        return reply
          .code(400)
          .send(
            rpcError(
              null,
              ERR.invalidRequest,
              "Batches aren't supported. Send one JSON-RPC message per request.",
            ),
          );
      if (!isObject(body))
        return reply
          .code(400)
          .send(
            rpcError(
              null,
              ERR.invalidRequest,
              "Send one JSON-RPC 2.0 request object.",
            ),
          );
      const id = isId(body.id) ? body.id : null;
      if (body.jsonrpc !== "2.0" || typeof body.method !== "string")
        return reply
          .code(400)
          .send(
            rpcError(
              id,
              ERR.invalidRequest,
              'A request needs "jsonrpc": "2.0" and a "method".',
            ),
          );
      if (body.id !== undefined && !isId(body.id))
        return reply
          .code(400)
          .send(
            rpcError(
              null,
              ERR.invalidRequest,
              "The request id must be a string or a number.",
            ),
          );
      if (body.params !== undefined && !isObject(body.params))
        return reply.send(
          rpcError(id, ERR.invalidParams, '"params" must be an object.'),
        );
      const method = body.method;
      const params = (body.params ?? {}) as Record<string, unknown>;
      if (method === LISTEN_METHOD) {
        if (!holdsStreams)
          return reply.send(
            rpcError(
              id,
              ERR.methodNotFound,
              "subscriptions/listen is served by Orbyn's realtime service; send it to the MCP address with the Mcp-Method header.",
            ),
          );
        const refused = checkListen(r.headers, body);
        if (refused) return reply.code(refused.status).send(refused.body);
        routeLabels.set(r, `mcp:${LISTEN_METHOD}`);
        return openListen(r, reply, caller, body);
      }

      const toolName =
        method === "tools/call" && typeof params.name === "string"
          ? params.name
          : null;
      if (
        method === "tools/call" &&
        params.arguments !== undefined &&
        !isObject(params.arguments)
      )
        return reply.send(
          rpcError(id, ERR.invalidParams, '"arguments" must be an object.'),
        );
      const cap = toolName ? registry.get(toolName) : undefined;
      routeLabels.set(r, routeLabel(method, toolName, cap?.name));

      // Step-up: a signed-in connection asking for a tool it was given too
      // little for gets 403 insufficient_scope naming every scope it needs,
      // so its app asks the person once (with re-authentication for write).
      // ChatGPT takes the same challenge on the tool result instead.
      const scope = cap ? stepUpScope(p, cap) : null;
      if (cap && scope && !isChatGpt(p)) {
        recorder.add({
          userId: p.user.id,
          grantId: p.grant_id!,
          clientName: p.client.name,
          tool: cap.name,
          tier: cap.tier,
          outcome: "denied",
          targets: [],
          argsDigest: null,
          summary: `${cap.title} · needs more access`,
          requestId: String(r.id),
          latencyMs: 0,
          write: false,
        });
        return reply
          .code(403)
          .header("WWW-Authenticate", insufficientScope(scope))
          .send(
            rpcError(
              id,
              ERR.forbidden,
              `This connection needs more access for ${cap.name}. Sign in again to allow it.`,
              { scope },
            ),
          );
      }

      // Maintenance: reads go on; changes get a JSON-RPC error.
      if (cap && cap.mode !== "read" && s.maintenance.enabled)
        return reply.send(
          rpcError(
            id,
            ERR.maintenance,
            (s.maintenance.message
              ? `Orbyn is under maintenance: ${s.maintenance.message}`
              : "Orbyn is under maintenance.") +
              " Changes are paused for now; searching and reading still work. Try again later.",
            s.maintenance.until ? { until: s.maintenance.until } : undefined,
          ),
        );

      const grantId = p.grant_id!;
      // Completions run as the person types, so they count as searches.
      const kind: LimitKind =
        cap?.mode && cap.mode !== "read"
          ? "write"
          : cap?.limitGroup === "search" || method === "completion/complete"
            ? "search"
            : cap?.limitGroup === "heavy"
              ? "heavy"
              : "call";
      const slot = await limiter.take(
        grantId,
        p.user.id,
        kind,
        s.agents.agent_limits,
        Date.now(),
        cap?.limitGroup === "heavy",
      );
      if (!slot.ok) {
        recorder.count(grantId, "limited");
        if (strikes.hit(grantId, "limited")) suspend(grantId, "rate_limit");
        return reply
          .code(429)
          .header("Retry-After", String(slot.retryAfter))
          .send(
            rpcError(
              id,
              ERR.rateLimited,
              `${slot.reason} Try again in ${slot.retryAfter} s.`,
              {
                retry_after: slot.retryAfter,
              },
            ),
          );
      }

      const since = Math.max(
        caller.lastWriteAt?.getTime() ?? 0,
        wrote.get(grantId) ?? 0,
      );
      const call: CallContext = {
        caller,
        settings: s,
        primary: Date.now() - since < READ_OWN_WRITES_MS,
        write: (fn) =>
          transaction(async (db) => {
            await actAs(db, p.user.id, grantId);
            const result = await fn(db);
            await db.query(
              "UPDATE agent_grants SET last_write_at = now() WHERE id = $1",
              [grantId],
            );
            wrote.set(grantId, Date.now());
            return result;
          }),
        onCall: (c, name, exec, ms, digest) => {
          if (
            exec.outcome === "denied" &&
            probing(exec) &&
            strikes.hit(grantId, "denied")
          )
            suspend(grantId, "probing");
          recorder.add({
            userId: p.user.id,
            grantId,
            clientName: p.client.name,
            tool: name,
            tier: c?.tier ?? "R",
            outcome: exec.outcome,
            targets: exec.targets,
            argsDigest: c && c.mode !== "read" ? digest : null,
            // What it was, in words; the outcome is kept beside it.
            summary: `${c?.title ?? name}${exec.targets.length ? ` · ${exec.targets.length} item${exec.targets.length === 1 ? "" : "s"}` : ""}`,
            requestId: String(r.id),
            latencyMs: ms,
            write: !!c && c.mode !== "read",
            recorded: !!exec.recorded,
          });
        },
        log: (err) => r.log.error({ err }, "MCP tool failed"),
        requestId: String(r.id),
      };

      let streaming = false;
      try {
        // Long jobs (the Tasks extension): the task methods, and a long
        // call from a client that declared the extension.
        const modern = r.headers["mcp-protocol-version"] === "2026-07-28";
        if (
          TASK_METHODS.has(method) ||
          (modern && declaresTasks(params) && cap)
        ) {
          const mismatch =
            (r.headers["mcp-method"] !== undefined &&
              r.headers["mcp-method"] !== method) ||
            (toolName !== null &&
              r.headers["mcp-name"] !== undefined &&
              r.headers["mcp-name"] !== toolName);
          if (modern && mismatch)
            return reply
              .code(400)
              .send(
                rpcError(
                  id,
                  -32020,
                  "The Mcp-Method or Mcp-Name header doesn't match the request.",
                ),
              );
        }
        if (TASK_METHODS.has(method)) {
          if (!modern)
            return reply.send(
              rpcError(id, ERR.methodNotFound, `Method not found: ${method}`),
            );
          return reply.send(await answerTaskMethod(p, id, method, params));
        }
        if (
          modern &&
          cap &&
          toolName &&
          declaresTasks(params) &&
          !scope &&
          (cap.mode === "read" || s.agents.agents_writes_enabled)
        ) {
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const kind = taskKind(cap.name, args);
          const answer = kind
            ? await startTask(call, cap, kind, id, args)
            : null;
          if (answer) return reply.send(answer);
        }

        const legacy = await isLegacyRequest(webRequest(r, body), body);
        const response = await serve(call, webRequest(r, body), body, legacy);
        reply.code(response.status);
        for (const [name, value] of response.headers)
          if (
            !/^(connection|keep-alive|transfer-encoding|content-length)$/i.test(
              name,
            )
          )
            reply.header(name, value);
        // Progress notifications: the answer is a stream of events, sent
        // as it's written (nothing buffered on the way).
        if (
          response.body &&
          /text\/event-stream/.test(response.headers.get("content-type") ?? "")
        ) {
          streaming = true;
          reply.header("X-Accel-Buffering", "no");
          const out = Readable.fromWeb(
            response.body as import("node:stream/web").ReadableStream,
          );
          out.once("close", () => slot.release());
          return reply.send(out);
        }
        const text = await response.text();
        return reply.send(text || undefined);
      } finally {
        if (!streaming) slot.release();
      }
    },
  );

  app.get("/mcp", { errorHandler: mcpErrorHandler }, notAllowed);
  app.delete("/mcp", { errorHandler: mcpErrorHandler }, notAllowed);

  // Where an agent learns how to sign in to this resource (RFC 9728).
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])
    app.get(path, async (_r, reply) =>
      reply
        .header("Cache-Control", "public, max-age=3600")
        .send(protectedResource()),
    );

  // The OpenAI apps directory's check that Orbyn owns this address: the
  // token it gave, as plain text, only while a submission asks for it.
  app.get("/.well-known/openai-apps-challenge", async (r, reply) =>
    env.OPENAI_APPS_CHALLENGE
      ? reply
          .header("Cache-Control", "no-store")
          .type("text/plain; charset=utf-8")
          .send(env.OPENAI_APPS_CHALLENGE)
      : reply.code(404).send({ message: "That isn't here.", request_id: r.id }),
  );

  // Any other well-known path is not here (not the web app's page).
  app.get("/.well-known/*", async (r, reply) =>
    reply.code(404).send({ message: "That isn't here.", request_id: r.id }),
  );
}
