import { z } from "zod";
import type { AssistantSource } from "./docs.js";
import type { ChatScope } from "./schemas.js";

/** Turns kept per chat, and characters per turn. */
export const CHAT_TURNS_MAX = 200;
export const CHAT_TURN_CHARS = 12000;

const chatSource = z
  .object({
    number: z.number().int().min(1).max(99).optional(),
    title: z.string().max(300),
    doc_id: z.uuid().optional(),
    block_id: z.string().max(80).nullable().optional(),
    kind: z.enum(["task", "decision", "change"]).optional(),
    id: z.string().max(80).optional(),
    project_id: z.uuid().optional(),
    quote: z.string().max(600).optional(),
  })
  .strip();

export const savedChatTurn = z
  .object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(CHAT_TURN_CHARS),
    /** Context sent back to the model, including the change outcome. */
    history_text: z.string().max(CHAT_TURN_CHARS).optional(),
    turn_id: z.uuid().optional(),
    proposal_id: z.uuid().optional(),
    /** Capability job containing the changes and their Undo records. */
    changes_job: z.uuid().optional(),
    outcome: z.enum(["pending", "applied", "discarded", "info"]).optional(),
    sources: z.array(chatSource).max(20).optional(),
  })
  .strict();
export type SavedChatTurn = z.output<typeof savedChatTurn>;

/** One observable step in a chat turn. Content is never recorded here. */
export const chatTraceEntry = z
  .object({
    turn_id: z.uuid(),
    step: z.number().int().min(1).max(64),
    kind: z.enum(["thinking", "tool", "result", "reply", "error"]),
    label: z.string().trim().min(1).max(180),
    tool: z.string().max(50).optional(),
    at: z.iso.datetime(),
  })
  .strict();
export type ChatTraceEntry = z.output<typeof chatTraceEntry>;

/** A list row in the assistant's saved chat history. */
export type AiChatSummary = {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string;
  pinned: boolean;
  turn_count: number;
  created_at: string;
  last_used_at: string;
  summary_doc_id: string | null;
  swept_at: string | null;
  scope: ChatScope | null;
  active?: "working" | "needs_you" | null;
};

/** A live assistant job that a client can reattach to. */
export type ActiveChatJob = {
  id: string;
  state: "queued" | "running" | "waiting";
  progress: { label?: string; [key: string]: unknown } | null;
  waiting: unknown;
};

export type AiChat = AiChatSummary & {
  active_job?: ActiveChatJob | null;
  turns: SavedChatTurn[];
  trace: ChatTraceEntry[];
};

/** The old names stay as aliases for clients being migrated to `ai_chats`. */
export type ProjectChatSummary = AiChatSummary;
export type ProjectChat = AiChat;

export const updateAiChatInput = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    turn_id: z.uuid().optional(),
    outcome: z.enum(["pending", "applied", "discarded", "info"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.pinned !== undefined ||
      (value.turn_id !== undefined && value.outcome !== undefined),
  );
export type UpdateAiChatInput = z.output<typeof updateAiChatInput>;

/** Legacy save input accepted while older clients roll forward. */
export const projectChatInput = z
  .object({
    project_id: z.uuid(),
    title: z.string().trim().min(1).max(120).optional(),
    turns: z.array(savedChatTurn).min(1).max(CHAT_TURNS_MAX),
  })
  .strict();
export type ProjectChatInput = z.input<typeof projectChatInput>;

/** A chat's name comes from its first question: one line, at most 80 characters. */
export function chatTitle(turns: { role: string; text: string }[]): string {
  const first = turns.find((t) => t.role === "user")?.text ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  if (!line) return "Chat";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** A conversation's turns as kept by either app. */
type LiveTurn =
  | { id?: string; role: "user"; text: string }
  | {
      id?: string;
      role: "assistant";
      proposal: { id?: string; summary: string; sources?: AssistantSource[] };
    };

/** The words and cited sources saved after a turn. */
export function savedTurnsOf(turns: LiveTurn[]): SavedChatTurn[] {
  return turns.slice(-CHAT_TURNS_MAX).map((t) =>
    t.role === "user"
      ? {
          role: "user",
          text: t.text.slice(0, CHAT_TURN_CHARS),
          ...(t.id ? { turn_id: t.id } : {}),
        }
      : {
          role: "assistant",
          text: t.proposal.summary.slice(0, CHAT_TURN_CHARS),
          ...(t.id ? { turn_id: t.id } : {}),
          ...(t.proposal.id ? { proposal_id: t.proposal.id } : {}),
          ...(t.proposal.sources?.length
            ? {
                sources: t.proposal.sources.slice(0, 20).map((s) => ({
                  ...(s.number ? { number: s.number } : {}),
                  title: s.title.slice(0, 300),
                  ...(s.quote ? { quote: s.quote.slice(0, 600) } : {}),
                  ...("doc_id" in s
                    ? { doc_id: s.doc_id, block_id: s.block_id }
                    : {
                        kind: s.kind,
                        id: s.id,
                        ...(s.project_id ? { project_id: s.project_id } : {}),
                      }),
                })),
              }
            : {}),
        },
  );
}

/** A saved assistant reply; its proposal is fetched only while it is pending. */
export function savedReply(
  turn: SavedChatTurn,
  n: number,
): { id: string; summary: string; actions: []; sources: AssistantSource[] } {
  return {
    id: turn.proposal_id ?? `saved-${n}`,
    summary: turn.text,
    actions: [],
    sources: (turn.sources ?? []).map((s): AssistantSource =>
      s.doc_id
        ? {
            doc_id: s.doc_id,
            title: s.title,
            block_id: s.block_id ?? null,
            quote: s.quote ?? "",
            ...(s.number ? { number: s.number } : {}),
          }
        : {
            kind: s.kind ?? "task",
            id: s.id ?? "",
            title: s.title,
            quote: s.quote ?? "",
            ...(s.project_id ? { project_id: s.project_id } : {}),
            ...(s.number ? { number: s.number } : {}),
          },
    ),
  };
}
