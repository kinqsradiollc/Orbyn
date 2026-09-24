import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { ZodError } from "zod";
import {
  addDays,
  dayTime,
  fail,
  HttpError,
  itemData,
  localDateKey,
} from "@orbyn/core";
import { env } from "../../config/env.js";
import { pool, transaction } from "../../db/pool.js";
import { authenticateApiKey, type UserRow } from "../../lib/auth.js";
import { cachedSettings, settings } from "../../lib/settings.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { validationMessage } from "../../services/http.js";
import { mutate } from "../items/service.js";
import { agendaEntries, loadPrefs } from "../planner/calendar.js";

// A minimal Model Context Protocol server over HTTP (JSON-RPC 2.0), so a
// person's own AI tools can search and add to their planner with a personal
// API key. No SDK: the few methods a client needs are handled directly.
//
// Only personal API keys sign in here, never an app session. One message per
// request (no batches). Every failure, including sign-in, is answered in
// JSON-RPC shape with a plain message, never a database's own words.

const PROTOCOL_VERSION = "2025-06-18";

/** JSON-RPC error codes: the standard ones, and ours in the server range. */
const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Changes are paused for maintenance; reading still works. */
  maintenance: -32000,
  unauthorized: -32001,
  forbidden: -32003,
  rateLimited: -32029,
} as const;

/** The tools this server offers, with JSON-Schema inputs MCP clients read. */
const TOOLS = [
  {
    name: "search_items",
    description:
      "Search the signed-in person's open tasks and events by words in the title or notes. Each result has its id and a link that opens it in Orbyn.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for." },
        limit: { type: "number", description: "Most results (default 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "add_task",
    description:
      "Add a task to the person's planner. The answer has the new task's id and a link that opens it in Orbyn.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due_at: {
          type: "string",
          description: "ISO 8601 with offset, e.g. 2026-03-02T09:00:00+11:00.",
        },
        priority: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title"],
    },
  },
  {
    name: "get_agenda",
    description:
      "The person's open tasks due and events from the start of today through the next few days (default 7, at most 31), in their time zone. Repeating events appear once per occurrence, and events from calendars they subscribe to (timetables, exams, shifts) are included.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number" } },
    },
  },
];

/** Tools that change something, refused while Orbyn is under maintenance. */
const WRITE_TOOLS = new Set(["add_task"]);

type Args = Record<string, unknown>;
type Id = string | number | null;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const isObject = (v: unknown): v is Args =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is Id =>
  typeof v === "string" || typeof v === "number" || v === null;

/** The web address that opens one task or event in Orbyn. */
export const itemLink = (id: string) =>
  `${env.APP_URL.replace(/\/$/, "")}/app/task/${id}`;

/** "Thu 25 Sep 09:00 (2026-09-24T23:00:00.000Z)": local first, exact after. */
function when(at: Date, timeZone: string, allDay = false) {
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(allDay ? {} : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  })
    .format(at)
    .replace(",", "");
  return allDay ? `${local}, all day` : `${local} (${at.toISOString()})`;
}

/** A LIKE pattern that matches `word` literally (its % and _ included). */
const likeWord = (word: string) => word.replace(/[\\%_]/g, "\\$&");

async function runTool(u: UserRow, name: string, args: Args): Promise<string> {
  if (name === "search_items") {
    const words = str(args.query)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map(likeWord);
    if (!words.length) return "Give some words to search for.";
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
    const [rows, prefs] = await Promise.all([
      pool.query<{
        id: string;
        title: string;
        kind: string;
        status: string;
        due_at: Date | null;
      }>(
        `SELECT i.id, i.title, i.kind, i.status, i.due_at FROM items i
           WHERE ${VISIBLE_ITEMS} AND i.status NOT IN ('done','cancelled')
             AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) w
                             WHERE (i.title || ' ' || i.notes) NOT ILIKE '%' || w || '%')
           ORDER BY i.due_at NULLS LAST, i.created_at DESC LIMIT $3`,
        [u.id, words, limit],
      ),
      loadPrefs(pool, u.id),
    ]);
    if (!rows.rows.length) return "No matching items.";
    return rows.rows
      .map(
        (r) =>
          `- ${r.title} (${r.kind}, ${r.status}${r.due_at ? `, due ${when(r.due_at, prefs.timezone)}` : ""})\n` +
          `  id: ${r.id} · open: ${itemLink(r.id)}`,
      )
      .join("\n");
  }

  if (name === "add_task") {
    const data = itemData.parse({
      title: str(args.title),
      notes: str(args.notes),
      kind: "task",
      priority: ["low", "medium", "high"].includes(str(args.priority))
        ? str(args.priority)
        : "medium",
      due_at: args.due_at ? str(args.due_at) : null,
    });
    const item = await transaction((db) =>
      mutate(db, u, { operation: "create", data }),
    );
    if (!item) fail(500, "The task wasn't saved.");
    return `Added "${item.title}".\nid: ${item.id} · open: ${itemLink(item.id)}`;
  }

  if (name === "get_agenda") {
    const days = Math.min(31, Math.max(1, Math.round(Number(args.days)) || 7));
    const { timezone } = await loadPrefs(pool, u.id);
    const today = localDateKey(new Date(), timezone);
    // From the start of today, so this morning's meeting still shows and a
    // task overdue for months doesn't.
    const from = dayTime(today, 0, timezone);
    const to = dayTime(addDays(today, days), 0, timezone);
    const [entries, tasks] = await Promise.all([
      // Events, repeating ones once per occurrence, and subscribed calendars.
      agendaEntries(pool, u.id, from, to),
      pool.query<{ id: string; title: string; due_at: Date }>(
        `SELECT i.id, i.title, i.due_at FROM items i
           WHERE ${VISIBLE_ITEMS} AND i.kind <> 'event'
             AND i.status NOT IN ('done','cancelled')
             AND i.due_at >= $2 AND i.due_at < $3
           ORDER BY i.due_at LIMIT 100`,
        [u.id, from, to],
      ),
    ]);
    // Events someone finished or cancelled drop out, as tasks do.
    const eventIds = [
      ...new Set(entries.flatMap((e) => (e.item_id ? [e.item_id] : []))),
    ];
    const closed = new Set(
      eventIds.length
        ? (
            await pool.query<{ id: string }>(
              "SELECT id FROM items WHERE id = ANY ($1::uuid[]) AND status IN ('done','cancelled')",
              [eventIds],
            )
          ).rows.map((r) => r.id)
        : [],
    );
    const lines = [
      ...entries
        .filter((e) => !e.item_id || !closed.has(e.item_id))
        .map((e) => ({
          at: e.start_at,
          text:
            `${when(new Date(e.start_at), timezone, e.all_day)} · ${e.title}` +
            (e.item_id
              ? ` (event)\n  id: ${e.item_id} · open: ${itemLink(e.item_id)}`
              : ` (from "${e.calendar ?? "a subscribed calendar"}")`),
        })),
      ...tasks.rows.map((t) => ({
        at: t.due_at.toISOString(),
        text:
          `${when(t.due_at, timezone)} · ${t.title} (task, due)\n` +
          `  id: ${t.id} · open: ${itemLink(t.id)}`,
      })),
    ]
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, 200);
    const last = addDays(today, days - 1);
    if (!lines.length)
      return `Nothing on the calendar or due from today through ${last} (${timezone}).`;
    return [
      `Today (${today}) through ${last}, in ${timezone}:`,
      ...lines.map((l) => `- ${l.text}`),
    ].join("\n");
  }
  throw new Error(`Unknown tool: ${name}`);
}

const rpc = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: Id, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/**
 * What to tell the client when a tool fails: the message the code wrote for
 * people, a validation problem in words, or a plain "try again". Never the
 * database's own text, which can quote internals.
 */
function toolErrorText(e: unknown, log: FastifyBaseLogger) {
  if (e instanceof HttpError && e.statusCode < 500) return e.message;
  if (e instanceof ZodError) return validationMessage(e.issues);
  if ((e as { code?: string }).code === "23505") return "This already exists.";
  log.error({ err: e }, "MCP tool failed");
  return "Something went wrong on Orbyn's side. Try again in a moment.";
}

async function handleOne(
  u: UserRow,
  msg: unknown,
  log: FastifyBaseLogger,
): Promise<object | null> {
  if (!isObject(msg))
    return rpcError(
      null,
      ERR.invalidRequest,
      "Send one JSON-RPC 2.0 request object.",
    );
  const id = isId(msg.id) ? msg.id : null;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return rpcError(
      id,
      ERR.invalidRequest,
      'A request needs "jsonrpc": "2.0" and a "method".',
    );
  // Notifications (no id) get no response.
  if (msg.id === undefined) return null;
  if (!isId(msg.id))
    return rpcError(
      null,
      ERR.invalidRequest,
      "The request id must be a string or a number.",
    );
  if (msg.params !== undefined && !isObject(msg.params))
    return rpcError(id, ERR.invalidParams, '"params" must be an object.');
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize":
      return rpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "Orbyn", version: "1" },
      });
    case "ping":
      return rpc(id, {});
    case "tools/list":
      return rpc(id, { tools: TOOLS });
    case "tools/call": {
      const name = str(params.name);
      if (!TOOLS.some((t) => t.name === name))
        return rpcError(
          id,
          ERR.invalidParams,
          `Unknown tool: ${name || "(none)"}. Call tools/list to see the tools.`,
        );
      if (params.arguments !== undefined && !isObject(params.arguments))
        return rpcError(
          id,
          ERR.invalidParams,
          '"arguments" must be an object.',
        );
      if (WRITE_TOOLS.has(name)) {
        const { maintenance } = await settings();
        if (maintenance.enabled)
          return rpcError(
            id,
            ERR.maintenance,
            (maintenance.message
              ? `Orbyn is under maintenance: ${maintenance.message}`
              : "Orbyn is under maintenance.") +
              " Changes are paused for now; searching and reading still work. Try again later.",
          );
      }
      try {
        const text = await runTool(u, name, params.arguments ?? {});
        return rpc(id, { content: [{ type: "text", text }] });
      } catch (e) {
        // Tool errors are reported in-band so the model can react.
        return rpc(id, {
          content: [{ type: "text", text: `Error: ${toolErrorText(e, log)}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(
        id,
        ERR.methodNotFound,
        `Method not found: ${msg.method}`,
      );
  }
}

/**
 * Origins a browser may call from: none at all (desktop and command-line
 * clients send no Origin), or Orbyn's own web app. Anything else is refused,
 * so a web page can't drive a local client's connection (DNS rebinding).
 */
function originAllowed(origin: string | undefined) {
  if (!origin) return true;
  const own = [
    ...cachedSettings().cors_origins,
    env.APP_URL.replace(/\/$/, ""),
  ];
  return own.includes(origin);
}

/** Every failure on /mcp, sign-in and limits included, as a JSON-RPC error. */
function mcpErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const status = error.statusCode ?? 500;
  const [code, message] =
    status === 401
      ? [ERR.unauthorized, error.message]
      : status === 403
        ? [ERR.forbidden, error.message]
        : status === 429
          ? [
              ERR.rateLimited,
              "That's a lot at once. Wait a moment and try again.",
            ]
          : status === 413
            ? [ERR.invalidRequest, "That request is too large to send."]
            : status === 415
              ? [ERR.parse, "Send the request as application/json."]
              : status === 400 && error.code?.startsWith("FST_ERR_CTP")
                ? [ERR.parse, "That request isn't valid JSON."]
                : error instanceof SyntaxError
                  ? [ERR.parse, "That request isn't valid JSON."]
                  : status < 500 && error instanceof HttpError
                    ? [ERR.invalidRequest, error.message]
                    : status < 500
                      ? [ERR.invalidRequest, "That request couldn't be read."]
                      : [
                          ERR.internal,
                          "Something went wrong on Orbyn's side. Try again in a moment.",
                        ];
  if (status >= 500) request.log.error({ err: error }, "MCP request failed");
  return reply.code(status).send(rpcError(null, code, message));
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post("/mcp", { errorHandler: mcpErrorHandler }, async (r, reply) => {
    if (!originAllowed(r.headers.origin))
      fail(403, "Requests from this web page aren't allowed.");
    const u = await authenticateApiKey(r);
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
    const res = await handleOne(u, body, r.log);
    return res ?? reply.code(202).send();
  });

  // Streams (GET) and ending a session (DELETE) aren't offered: this server
  // keeps no sessions and sends nothing on its own.
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
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
