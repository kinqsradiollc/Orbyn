import { z } from "zod";
import {
  assistantChatVisible,
  conversationExecutionChatVisible,
} from "../lib/assistant-visibility.js";
import {
  assistantRetainedEntryVisible,
  assistantChatEvidenceKnown,
} from "../lib/assistant-source-visibility.js";
import { deliveryBindingVisible } from "../lib/assistant-binding-visibility.js";
import { docPlainText, type DocBlock } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleProjects,
} from "../lib/visibility.js";
import { refUrl } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";

/**
 * How much of a compacted chat's summary note an answer carries: opening
 * one chat gives the note's words, a list only its start.
 */
const SUMMARY_CHARS = 4_000;
const SUMMARY_PREVIEW = 300;

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
  summary: z
    .object({
      title: z.string(),
      text: z.string(),
      truncated: z.boolean(),
      url: z.string(),
    })
    .nullable()
    .describe(
      "A compacted chat's private summary note (null when none or kept out).",
    ),
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
  legacy_visible: boolean;
  source_entry_ids: string[];
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
  // The expanded source checks cost far more to compile than to execute.
  // Keep JIT off only for this read, including its retained-history projection.
  readJit: false,
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
    const legacyVisible = assistantChatVisible("c", user, scope);
    const safeTitle = `CASE WHEN active_stream.id IS NOT NULL AND NOT ${legacyVisible} THEN 'Conversation' ELSE c.title END`;
    const history = `CASE WHEN active_stream.id IS NULL THEN c.turns ELSE projected.turns END`;
    const rows = (
      await ctx.db.query<Row>(
        `SELECT c.id, c.project_id, p.name AS project_name, ${safeTitle} AS title, c.pinned,
                ${history} AS turns, CASE WHEN active_stream.id IS NULL THEN c.trace ELSE '[]'::jsonb END AS trace,
                c.created_at, c.last_used_at,c.summary_doc_id, c.swept_at, c.scope_kind, c.scope_id,
                ${legacyVisible} AS legacy_visible,coalesce(projected.source_entry_ids,'{}'::uuid[]) AS source_entry_ids
           FROM ai_chats c LEFT JOIN projects p ON p.id = c.project_id
           LEFT JOIN assistant_conversation_streams active_stream ON active_stream.chat_id=c.id AND active_stream.retired_at IS NULL
           LEFT JOIN LATERAL (
             SELECT coalesce(jsonb_agg(saved.payload ORDER BY saved.sequence),'[]'::jsonb) AS turns,
               array_agg(saved.id ORDER BY saved.sequence) AS source_entry_ids
             FROM (SELECT e.id,e.payload,e.sequence FROM assistant_conversation_entries e
               WHERE e.destination_id=active_stream.id AND e.kind='turn' AND ${assistantRetainedEntryVisible("e.id", user, scope)}
               ORDER BY e.sequence DESC LIMIT 200) saved
           ) projected ON active_stream.id IS NOT NULL
          WHERE c.user_id = ${user} AND ${visible} AND ${conversationExecutionChatVisible("c", user, scope)} AND (active_stream.id IS NOT NULL OR ${assistantChatEvidenceKnown("c", user)})
            AND (active_stream.id IS NOT NULL OR NOT EXISTS(
              SELECT 1 FROM assistant_delivery_bindings b JOIN assistant_delivery_intents i ON i.binding_id=b.id
              WHERE b.owner_id=${user} AND i.payload->>'execution_chat_id'=c.id::text AND NOT ${deliveryBindingVisible("b", user)}))
            AND (${chatId ? `c.id = ${chatId}` : "c.origin <> 'idea'"})
            AND (${projectId ? `c.project_id = ${projectId}` : "true"})
            AND (${search} = '' OR ${safeTitle} ILIKE '%' || ${search} || '%'
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(${history}) t
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

    // A compacted chat's turns live on in its private Agent note: carry the
    // note's words, unless it is gone or in a project kept out of AI.
    const noteIds = [
      ...new Set(
        rows
          .filter((row) => row.swept_at && row.summary_doc_id)
          .map((row) => row.summary_doc_id!),
      ),
    ];
    const notes = new Map<
      string,
      { title: string; text: string; truncated: boolean; url: string }
    >();
    if (noteIds.length) {
      const q = new Params();
      const docScope = scopeFor(ctx.spaces, q);
      const ids = q.add(noteIds);
      const found = (
        await ctx.db.query<{ id: string; title: string; content: unknown }>(
          `SELECT d.id, d.title, d.content FROM docs d
            WHERE d.id = ANY(${ids}::uuid[]) AND d.team_id IS NULL
              AND d.kind = 'agent' AND ${visibleDocs("d", docScope)}`,
          q.values,
        )
      ).rows;
      const most = args.chat_id ? SUMMARY_CHARS : SUMMARY_PREVIEW;
      for (const doc of found) {
        const text = Array.isArray(doc.content)
          ? docPlainText(doc.content as DocBlock[])
          : "";
        notes.set(doc.id, {
          title: doc.title,
          text: text.slice(0, most),
          truncated: text.length > most,
          url: refUrl({ type: "doc", id: doc.id }),
        });
      }
    }

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
        summary:
          swept && row.summary_doc_id
            ? (notes.get(row.summary_doc_id) ?? null)
            : null,
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
              ? item.summary
                ? `Summary note: ${item.summary.title} (${item.summary.url})${args.chat_id ? `\n\n${item.summary.text}${item.summary.truncated ? " …" : ""}` : ""}`
                : "Summary note: not available"
              : `${item.turn_count} turns`;
            return `## ${item.title}\nChat id: ${item.id}\n${status}${details ? `\n\n${details}` : ""}`;
          })
          .join("\n\n")
      : "No assistant chats matched.";
    return {
      structured: { chats },
      markdown,
      targets: rows.flatMap((row) => [
        ...(row.legacy_visible ? [`chat:${row.id}`] : []),
        ...(args.chat_id
          ? row.source_entry_ids.map((id) => `entry:${id}`)
          : []),
        ...(row.swept_at && row.summary_doc_id && notes.has(row.summary_doc_id)
          ? [`doc:${row.summary_doc_id}`]
          : []),
      ]),
    };
  },
});
