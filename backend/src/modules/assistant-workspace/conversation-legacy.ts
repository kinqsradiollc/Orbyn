import { createHash } from "node:crypto";
import {
  assistantSavedHistory,
  assistantSavedHistoryQuery,
  savedChatTurn,
  fail,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { conversationDestination } from "./conversation-storage.js";

export function untrackedHistoryTurn(value: string, destination: string) {
  return `(${value}->>'role' IN ('user','assistant') AND jsonb_typeof(${value}->'text')='string'
    AND NOT EXISTS(SELECT 1 FROM assistant_conversation_entries tracked
      WHERE tracked.destination_id=${destination} AND tracked.kind='turn'
        AND tracked.turn_id::text=${value}->>'turn_id' AND tracked.role=${value}->>'role'))`;
}

/** No history import, source rewrite, unread state or proposal controls. */
export async function readSavedConversationHistory(
  db: Queryable,
  owner: string,
  destinationId: string,
  value: unknown,
) {
  const query = assistantSavedHistoryQuery.parse(value);
  const destination = await conversationDestination(db, owner, destinationId);
  if (!destination) fail(404, "Saved history is no longer available.");
  const row = (
    await db.query<{ turns: unknown[] }>(
      `SELECT coalesce((SELECT jsonb_agg(item.value ORDER BY item.position)
       FROM jsonb_array_elements(c.turns) WITH ORDINALITY item(value,position)
       WHERE ${untrackedHistoryTurn("item.value", "$3")}
         AND (jsonb_typeof(item.value->'nudge') IS DISTINCT FROM 'object' OR EXISTS(
           SELECT 1 FROM assistant_nudges n WHERE n.id::text=item.value->'nudge'->>'id'
             AND n.user_id=$1 AND ${assistantSourceVisible("n.entity_kind", "n.entity_id", "$1", false)}))), '[]') AS turns
     FROM ai_chats c WHERE c.id=$2 AND c.user_id=$1 AND c.swept_at IS NULL AND ${assistantChatVisible("c", "$1")}`,
      [owner, destination.chat_id, destinationId],
    )
  ).rows[0];
  if (!row) fail(404, "Saved history is no longer available.");
  const turns = row.turns.slice(-200).flatMap((turn) => {
    const parsed = savedChatTurn.safeParse(turn);
    return parsed.success
      ? [
          {
            role: parsed.data.role,
            text: parsed.data.text,
            ...(parsed.data.turn_id ? { turn_id: parsed.data.turn_id } : {}),
          },
        ]
      : [];
  });
  const version = createHash("sha256")
    .update(JSON.stringify(turns))
    .digest("hex");
  if (query.version && query.version !== version)
    fail(409, "Saved history changed. Reload it to continue.");
  const upper = query.before ?? turns.length;
  if (upper > turns.length)
    fail(400, "That history cursor is no longer available.");
  const lower = Math.max(0, upper - query.limit);
  return assistantSavedHistory.parse({
    destination_id: destinationId,
    chat_id: destination.chat_id,
    version,
    before: lower || null,
    turns: turns.slice(lower, upper),
  });
}
