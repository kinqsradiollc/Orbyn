import { z } from "zod";
import {
  assistantConversationEntry,
  fail,
  savedChatTurn,
  type ChatTurn,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { conversationEntryVisible } from "./conversation-feed.js";
import { conversationDestination } from "./conversation-storage.js";
export { conversationExecutionChatVisible } from "../../lib/assistant-visibility.js";

export const conversationContextIdentity = z
  .object({
    destination_id: z.uuid(),
    entry_ids: z.array(z.uuid()).max(13),
    reply_to_entry_id: z.uuid().optional(),
  })
  .strict();
export type ConversationContextIdentity = z.output<
  typeof conversationContextIdentity
>;

/** Capture a bounded authorized foreground snapshot; incoming updates never join it implicitly. */
export async function prepareConversationContext(
  db: Queryable,
  owner: string,
  chatId: string,
  turnId: string,
  replyId?: string,
) {
  if (env.ASSISTANT_CONVERSATION_ENABLED !== "true") {
    if (replyId) fail(404, "Conversation entry not found.");
    // Rollback pauses delivery, not the authority of already-retained context.
  }
  const stream = (
    await db.query<{ id: string }>(
      "SELECT id FROM assistant_conversation_streams WHERE owner_id=$1 AND chat_id=$2 AND retired_at IS NULL",
      [owner, chatId],
    )
  ).rows[0];
  if (!stream) {
    if (replyId) fail(404, "Conversation entry not found.");
    return null;
  }
  if (!(await conversationDestination(db, owner, stream.id)))
    fail(404, "Conversation not found.");
  const rows = (
    await db.query<{ id: string; payload: unknown }>(
      `SELECT e.id,e.payload FROM assistant_conversation_entries e
    WHERE e.destination_id=$2 AND e.kind='turn' AND e.turn_id<>$3 AND ${conversationEntryVisible()}
    ORDER BY e.sequence DESC LIMIT 12`,
      [owner, stream.id, turnId],
    )
  ).rows.reverse();
  const history: ChatTurn[] = rows.map((row) => {
    const turn = savedChatTurn.parse(row.payload);
    return { role: turn.role, content: turn.history_text ?? turn.text };
  });
  const entryIds = rows.map((row) => row.id);
  if (replyId && !entryIds.includes(replyId)) {
    const row = (
      await db.query<{ kind: string; payload: unknown }>(
        `SELECT e.kind,e.payload FROM assistant_conversation_entries e
      WHERE e.id=$3 AND e.destination_id=$2 AND ${conversationEntryVisible()}`,
        [owner, stream.id, replyId],
      )
    ).rows[0];
    if (!row) fail(404, "Conversation entry not found.");
    if (row.kind === "turn") {
      const turn = savedChatTurn.parse(row.payload);
      history.push({
        role: turn.role,
        content: turn.history_text ?? turn.text,
      });
    } else {
      const entry = assistantConversationEntry.parse({
        ...(row.payload as object),
        kind: "update",
        id: replyId,
        sequence: "1",
        revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (entry.kind !== "update") fail(422, "Invalid reply target.");
      history.push({
        role: "assistant",
        content: `Selected work (${entry.work.kind}:${entry.work.id}):\n${entry.text}`,
      });
    }
    entryIds.push(replyId);
  }
  // Dependencies of a derived reply persist with its turn before it is saved.
  await db.query(
    `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
    SELECT $1,$2,s.source_kind,s.source_id FROM assistant_conversation_entry_sources s WHERE s.entry_id=ANY($3::uuid[])
    ON CONFLICT DO NOTHING`,
    [chatId, turnId, entryIds],
  );
  await db.query(
    `INSERT INTO assistant_turn_entry_sources(chat_id,turn_id,source_entry_id)
     SELECT $1,$2,id FROM assistant_conversation_entries WHERE id=ANY($3::uuid[])
     ON CONFLICT DO NOTHING`,
    [chatId, turnId, entryIds],
  );
  return {
    history,
    identity: conversationContextIdentity.parse({
      destination_id: stream.id,
      entry_ids: entryIds,
      ...(replyId ? { reply_to_entry_id: replyId } : {}),
    }),
  };
}

/** Recheck the admitted snapshot, without substituting newer messages or another job. */
export async function assertConversationContext(
  db: Queryable,
  owner: string,
  value: unknown,
) {
  const context = conversationContextIdentity.parse(value);
  if (!(await conversationDestination(db, owner, context.destination_id)))
    fail(404, "Conversation not found.");
  const count = (
    await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM assistant_conversation_entries e
    WHERE e.destination_id=$2 AND e.id=ANY($3::uuid[]) AND ${conversationEntryVisible()}`,
      [owner, context.destination_id, context.entry_ids],
    )
  ).rows[0].count;
  if (count !== new Set(context.entry_ids).size)
    fail(
      409,
      "The sources for this reply changed. Refresh the conversation before continuing.",
    );
}
