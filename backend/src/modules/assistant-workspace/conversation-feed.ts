import { readOutcomeReceipts } from "./outcome-receipts.js";
import {
  assistantConversationPage,
  assistantConversationQuery,
  assistantConversationReadInput,
  fail,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";
import { conversationDestination } from "./conversation-storage.js";
import { conversationEntryVisible } from "../../lib/assistant-conversation-visibility.js";
export { conversationEntryVisible } from "../../lib/assistant-conversation-visibility.js";
import { conversationWaitingKind } from "./conversation-questions.js";

/**
 * Read under a primary read transaction. Filter sources before loading payloads;
 * an inaccessible entry is absent, without leaking its title or source identity.
 * Hidden gaps advance the cursor so clients cannot get stuck replaying them.
 */
export async function conversationFeed(
  db: Queryable,
  ownerId: string,
  destinationId: string,
  value: unknown,
  personalOnly = false,
  includeOutcomes = true,
) {
  const destination = await conversationDestination(db, ownerId, destinationId);
  if (!destination) fail(404, "Conversation not found.");
  const { after, limit, through } = assistantConversationQuery.parse(value);
  const upper = through ?? destination.last_sequence;
  if (BigInt(upper) > BigInt(destination.last_sequence))
    fail(400, "That cursor is ahead of this conversation.");
  if (BigInt(after) > BigInt(destination.last_sequence))
    fail(400, "That cursor is ahead of this conversation.");
  const rows = (
    await db.query<{
      id: string;
      sequence: string;
      revision: number;
      kind: "turn" | "update";
      turn_id: string | null;
      reply_to_entry_id: string | null;
      payload: Record<string, unknown>;
      waiting_kind: "person" | "approval" | null;
      execution_chat_available: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT e.id,e.sequence::text,e.revision,e.kind,e.turn_id,
       e.reply_to_entry_id,e.payload,e.created_at,e.updated_at,
       ${conversationWaitingKind("e.payload", "$1")} AS waiting_kind,
       EXISTS(SELECT 1 FROM ai_chats linked_chat WHERE linked_chat.user_id=$1 AND linked_chat.swept_at IS NULL
         AND linked_chat.id=CASE WHEN e.payload->>'execution_chat_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN (e.payload->>'execution_chat_id')::uuid END) AS execution_chat_available
     FROM assistant_conversation_entries e
     WHERE e.destination_id=$2 AND e.sequence>$3::bigint AND e.sequence<=$4::bigint
       AND ${conversationEntryVisible()}
       ${personalOnly ? `AND NOT EXISTS(SELECT 1 FROM assistant_conversation_entry_sources export_source WHERE export_source.entry_id=e.id AND NOT ${assistantSourceVisible("export_source.source_kind", "export_source.source_id", "$1", false, { user: "$1", personal: true, teams: "'{}'" })})` : ""}
     ORDER BY e.sequence LIMIT $5`,
      [ownerId, destinationId, after, upper, limit + 1],
    )
  ).rows;
  // Export keeps its existing personal-source projection. Runtime receipts are
  // optional display evidence and must pass current job-source access as well.
  const receipts =
    personalOnly || !includeOutcomes
      ? new Map()
      : await readOutcomeReceipts(
          db,
          ownerId,
          destination.chat_id,
          rows
            .slice(0, limit)
            .flatMap((row) =>
              row.kind === "turn" && row.turn_id ? [row.turn_id] : [],
            ),
        );
  for (const row of rows) {
    delete row.payload.execution_outcome;
    if (
      row.kind === "turn" &&
      row.payload.role === "assistant" &&
      row.turn_id &&
      receipts.has(row.turn_id)
    )
      row.payload.execution_outcome = receipts.get(row.turn_id);
  }
  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit).map((row) => ({
    ...(row.kind === "turn"
      ? {
          kind: "turn",
          turn_id: row.turn_id,
          turn: row.payload,
          reply_to_entry_id: row.reply_to_entry_id,
        }
      : {
          ...row.payload,
          kind: "update",
          execution_chat_id: row.execution_chat_available
            ? row.payload.execution_chat_id
            : null,
          ...(row.payload.event === "question"
            ? {
                waiting_kind: row.waiting_kind,
                actionable: row.waiting_kind !== null,
              }
            : {}),
        }),
    id: row.id,
    sequence: row.sequence,
    revision: row.revision,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }));
  return assistantConversationPage.parse({
    destination,
    cursor: hasMore ? entries.at(-1)!.sequence : upper,
    has_more: hasMore,
    entries,
  });
}

/** Explicit displayed-entry acknowledgement, never called by fetch or polling. */
export async function acknowledgeConversation(
  db: Queryable,
  ownerId: string,
  destinationId: string,
  value: unknown,
) {
  const { through } = assistantConversationReadInput.parse(value);
  const destination = await conversationDestination(db, ownerId, destinationId);
  if (!destination) fail(404, "Conversation not found.");
  const visible = (
    await db.query(
      `SELECT e.id FROM assistant_conversation_entries e
     WHERE e.destination_id=$2 AND e.sequence=$3::bigint AND ${conversationEntryVisible()}`,
      [ownerId, destinationId, through],
    )
  ).rows[0];
  if (!visible) fail(404, "Conversation entry not found.");
  await db.query(
    `UPDATE assistant_conversation_streams SET read_sequence=greatest(read_sequence,$3::bigint)
     WHERE owner_id=$1 AND id=$2 AND retired_at IS NULL`,
    [ownerId, destinationId, through],
  );
  await db.query(
    `UPDATE notifications n SET read=true FROM assistant_conversation_entries e
    WHERE n.user_id=$1 AND n.kind='assistant' AND e.destination_id=$2 AND e.sequence<=$3::bigint
      AND n.ref='conversation:' || e.destination_id::text || ':' || e.id::text`,
    [ownerId, destinationId, through],
  );
  const updated = await conversationDestination(db, ownerId, destinationId);
  if (!updated) fail(404, "Conversation not found.");
  return updated;
}
