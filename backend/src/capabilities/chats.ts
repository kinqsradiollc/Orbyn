import { z } from "zod";
import { Params, scopeFor, visibleProjects } from "../lib/visibility.js";
import { CapabilityError, defineCapability } from "./registry.js";

const input = z
  .object({
    chat_id: z.uuid().optional().describe("Open one chat by id."),
    search: z.string().trim().max(200).default(""),
    project_id: z.uuid().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

const source = z.object({
  title: z.string(),
  doc_id: z.string().optional(),
  block_id: z.string().nullable().optional(),
  kind: z.enum(["task", "decision", "change"]).optional(),
  id: z.string().optional(),
});

const turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  outcome: z.enum(["pending", "applied", "discarded", "info"]).optional(),
  sources: z.array(source).optional(),
});

const traceEntry = z.object({
  step: z.number().int(),
  kind: z.enum(["thinking", "tool", "result", "reply", "error"]),
  label: z.string(),
  tool: z.string().optional(),
});

const chat = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  turn_count: z.number().int(),
  summary_doc_id: z.string().nullable(),
  swept_at: z.string().nullable(),
  scope: z
    .object({ kind: z.enum(["project", "task"]), id: z.string() })
    .nullable(),
  turns: z.array(turn),
  trace: z.array(traceEntry),
});

const output = z.object({ chats: z.array(chat) });

type Row = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  pinned: boolean;
  turns: unknown;
  trace: unknown;
  created_at: Date;
  last_used_at: Date;
  summary_doc_id: string | null;
  swept_at: Date | null;
  scope_kind: "project" | "task" | null;
  scope_id: string | null;
};

/** Read the person's saved assistant conversations without calling a model. */
export const getChats = defineCapability({
  name: "get_chats",
  title: "Read assistant chats",
  description:
    "Reads saved chats, turns, and content-free steps. Search titles and turns, or pass chat_id. Projects kept out of AI are hidden.",
  input,
  output,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, args) {
    if (!ctx.spaces.personal)
      throw new CapabilityError(
        "FORBIDDEN",
        "Reading private assistant chats needs Personal access.",
        "Give this connection Personal access, then try again.",
      );

    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const user = scope.user;
    const chatId = args.chat_id ? p.add(args.chat_id) : undefined;
    const projectId = args.project_id ? p.add(args.project_id) : undefined;
    const search = p.add(args.search);
    const limit = p.add(args.chat_id ? 1 : args.limit);
    // Private, unscoped chats require Personal access. Project chats additionally
    // require that this connection can reach the project and that AI is on.
    const visible = `(c.project_id IS NULL OR EXISTS (
      SELECT 1 FROM projects p WHERE p.id = c.project_id
        AND ${visibleProjects("p", scope)}))`;
    const rows = (
      await ctx.db.query<Row>(
        `SELECT c.id, c.project_id, p.name AS project_name, c.title, c.pinned,
                c.turns, c.trace, c.created_at, c.last_used_at,
                c.summary_doc_id, c.swept_at, c.scope_kind, c.scope_id
           FROM ai_chats c LEFT JOIN projects p ON p.id = c.project_id
          WHERE c.user_id = ${user} AND ${visible}
            AND (${chatId ? `c.id = ${chatId}` : "true"})
            AND (${projectId ? `c.project_id = ${projectId}` : "true"})
            AND (${search} = '' OR c.title ILIKE '%' || ${search} || '%'
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(c.turns) t
                           WHERE t->>'text' ILIKE '%' || ${search} || '%'))
          ORDER BY c.pinned DESC, c.last_used_at DESC, c.id
          LIMIT ${limit}`,
        p.values,
      )
    ).rows;

    if (args.chat_id && !rows.length)
      throw new CapabilityError(
        "NOT_FOUND",
        "That chat is not reachable from this connection.",
        "List recent chats and use an id from the results.",
      );

    const chats = rows.map((row) => {
      const turns = Array.isArray(row.turns)
        ? row.turns.flatMap((value) => {
            const parsed = turn.safeParse(value);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      const trace = Array.isArray(row.trace)
        ? row.trace.flatMap((value) => {
            const parsed = traceEntry.safeParse(value);
            return parsed.success ? [parsed.data] : [];
          })
        : [];
      const swept = row.swept_at !== null;
      return {
        id: row.id,
        title: row.title,
        pinned: row.pinned,
        turn_count: turns.length,
        summary_doc_id: row.summary_doc_id,
        swept_at: row.swept_at?.toISOString() ?? null,
        scope:
          row.scope_kind && row.scope_id
            ? { kind: row.scope_kind, id: row.scope_id }
            : null,
        turns: args.chat_id && !swept ? turns : [],
        trace: args.chat_id && !swept ? trace : [],
      };
    });

    const markdown = chats.length
      ? chats
          .map((item) => {
            const details = item.turns
              .map((turn) => `**${turn.role}:** ${turn.text}`)
              .join("\n\n");
            const status = item.swept_at
              ? `Summary note: ${item.summary_doc_id ?? "not available"}`
              : `${item.turn_count} turns`;
            return `## ${item.title}\nChat id: ${item.id}\n${status}${details ? `\n\n${details}` : ""}`;
          })
          .join("\n\n")
      : "No assistant chats matched.";
    return { structured: { chats }, markdown };
  },
});
