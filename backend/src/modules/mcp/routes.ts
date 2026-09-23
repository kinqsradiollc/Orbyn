import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { itemData } from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { mutate } from "../items/service.js";
import { externalEntries } from "../planner/subscriptions.js";

// A minimal Model Context Protocol server over HTTP (JSON-RPC 2.0), so a
// person's own AI tools can search and add to their planner with a personal
// API key. No SDK: the few methods a client needs are handled directly.

const PROTOCOL_VERSION = "2025-06-18";

/** The tools this server offers, with JSON-Schema inputs MCP clients read. */
const TOOLS = [
  {
    name: "search_items",
    description:
      "Search the signed-in person's tasks and events by words in the title or notes.",
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
    description: "Add a task to the person's planner.",
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
      "The person's open tasks and events in the next few days (default 7), including events from calendars they subscribe to (timetables, exams, shifts).",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number" } },
    },
  },
];

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function runTool(u: UserRow, name: string, args: Args): Promise<string> {
  if (name === "search_items") {
    const words = str(args.query)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    if (!words.length) return "Give some words to search for.";
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
    const rows = (
      await pool.query<{
        title: string;
        kind: string;
        status: string;
        due_at: Date | null;
      }>(
        `SELECT i.title, i.kind, i.status, i.due_at FROM items i
           WHERE ${VISIBLE_ITEMS} AND i.status NOT IN ('done','cancelled')
             AND NOT EXISTS (SELECT 1 FROM unnest($2::text[]) w
                             WHERE (i.title || ' ' || i.notes) NOT ILIKE '%' || w || '%')
           ORDER BY i.due_at NULLS LAST, i.created_at DESC LIMIT $3`,
        [u.id, words, limit],
      )
    ).rows;
    if (!rows.length) return "No matching items.";
    return rows
      .map(
        (r) =>
          `- ${r.title} (${r.kind}, ${r.status}${r.due_at ? `, due ${r.due_at.toISOString()}` : ""})`,
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
      mutate(db, { id: u.id, role: u.role }, { operation: "create", data }),
    );
    return `Added "${item!.title}".`;
  }

  if (name === "get_agenda") {
    const days = Math.min(31, Math.max(1, Number(args.days) || 7));
    const rows = (
      await pool.query<{ title: string; kind: string; due_at: Date | null }>(
        `SELECT i.title, i.kind, i.due_at FROM items i
           WHERE ${VISIBLE_ITEMS} AND i.status NOT IN ('done','cancelled')
             AND i.due_at IS NOT NULL
             AND i.due_at < now() + ($2 || ' days')::interval
           ORDER BY i.due_at LIMIT 100`,
        [u.id, String(days)],
      )
    ).rows;
    const now = new Date();
    const subscribed = await externalEntries(
      pool,
      u.id,
      now,
      new Date(now.getTime() + days * 86_400_000),
      { visible: true },
    );
    const lines = [
      ...rows.map((r) => ({
        at: r.due_at!.toISOString(),
        text: `${r.title} (${r.kind})`,
      })),
      ...subscribed.slice(0, 200).map((e) => ({
        at: e.start_at,
        text: `${e.title} (${e.all_day ? "all day, " : ""}from "${e.name}")`,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    if (!lines.length) return `Nothing due in the next ${days} days.`;
    return lines.map((l) => `- ${l.at} — ${l.text}`).join("\n");
  }
  throw new Error(`Unknown tool: ${name}`);
}

const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

async function handleOne(
  u: UserRow,
  msg: { id?: unknown; method?: string; params?: Args },
) {
  const { id, method, params = {} } = msg;
  // Notifications (no id) get no response.
  if (id === undefined) return null;
  switch (method) {
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
      const name = str((params as Args).name);
      const args = ((params as Args).arguments as Args) ?? {};
      if (!TOOLS.some((t) => t.name === name))
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const text = await runTool(u, name, args);
        return rpc(id, { content: [{ type: "text", text }] });
      } catch (e) {
        // Tool errors are reported in-band so the model can react.
        return rpc(id, {
          content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post("/mcp", async (r: FastifyRequest, reply: FastifyReply) => {
    const u = await authenticate(r);
    const body = r.body as unknown;
    if (Array.isArray(body)) {
      const out = [];
      for (const m of body) {
        const res = await handleOne(u, m ?? {});
        if (res) out.push(res);
      }
      return out.length ? out : reply.code(202).send();
    }
    const res = await handleOne(u, (body as { method?: string }) ?? {});
    return res ?? reply.code(202).send();
  });
}
