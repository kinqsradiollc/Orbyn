import { z } from "zod";
import type { AssistantSource } from "./docs.js";

/**
 * Saved project chats: a person's own conversations with the assistant
 * about one project, kept so they can be picked up again. Only the words
 * are kept (and the sources a reply cited), never a pending change: a
 * proposal still has to be asked for again. Never shared, even in a team
 * project.
 */

/** Turns kept per chat, and characters per turn. */
export const CHAT_TURNS_MAX = 40;
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
    sources: z.array(chatSource).max(20).optional(),
  })
  .strict();
export type SavedChatTurn = z.output<typeof savedChatTurn>;

/** `PUT /ai/chats/:id`: save a chat (made by the app) after a reply. */
export const projectChatInput = z
  .object({
    project_id: z.uuid(),
    /** Its name in the list; the first question when left out. */
    title: z.string().trim().min(1).max(120).optional(),
    turns: z.array(savedChatTurn).min(1).max(CHAT_TURNS_MAX),
  })
  .strict();
export type ProjectChatInput = z.input<typeof projectChatInput>;

/** A saved chat in a project's list. */
export type ProjectChatSummary = {
  id: string;
  project_id: string;
  title: string;
  turn_count: number;
  created_at: string;
  updated_at: string;
};

export type ProjectChat = ProjectChatSummary & { turns: SavedChatTurn[] };

/** A chat's name from its first question: one line, at most 80 characters. */
export function chatTitle(turns: { role: string; text: string }[]): string {
  const first = turns.find((t) => t.role === "user")?.text ?? "";
  const line = first.replace(/\s+/g, " ").trim();
  if (!line) return "Chat";
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}

/** A conversation's turns as either app keeps them. */
type LiveTurn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      proposal: { summary: string; sources?: AssistantSource[] };
    };

/** The turns to save: the words and cited sources, never pending changes. */
export function savedTurnsOf(turns: LiveTurn[]): SavedChatTurn[] {
  return turns.slice(-CHAT_TURNS_MAX).map((t) =>
    t.role === "user"
      ? { role: "user", text: t.text.slice(0, CHAT_TURN_CHARS) }
      : {
          role: "assistant",
          text: t.proposal.summary.slice(0, CHAT_TURN_CHARS),
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

/**
 * A saved assistant turn as a reply to show: its words and sources, with no
 * changes to approve (those have to be asked for again).
 */
export function savedReply(
  turn: SavedChatTurn,
  n: number,
): { id: string; summary: string; actions: []; sources: AssistantSource[] } {
  return {
    id: `saved-${n}`,
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
