import { randomUUID } from "node:crypto";
import {
  assistantConversationDestination,
  savedChatTurn,
  fail,
  type AssistantConversationDestination,
  type SavedChatTurn,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import {
  assistantChatContainerVisible,
  conversationExecutionChatVisible,
} from "../../lib/assistant-visibility.js";

type StreamRow = {
  id: string;
  chat_id: string;
  personal: boolean;
  last_sequence: string;
  read_sequence: string;
};
const fields =
  "s.id,s.chat_id,s.personal,s.last_sequence::text,s.read_sequence::text";

/** Existing destinations only. Workers must never call the explicit-open path. */
export async function conversationDestination(
  db: Queryable,
  ownerId: string,
  destinationId: string,
): Promise<AssistantConversationDestination | null> {
  const row = (
    await db.query<StreamRow>(
      `SELECT ${fields} FROM assistant_conversation_streams s
     JOIN ai_chats c ON c.id=s.chat_id JOIN users u ON u.id=s.owner_id
     WHERE s.owner_id=$1 AND s.id=$2 AND s.retired_at IS NULL
       AND NOT u.disabled AND c.swept_at IS NULL
       AND ((s.personal AND c.user_id=$1 AND c.project_id IS NULL AND c.scope_kind IS NULL)
         OR (NOT s.personal AND ${assistantChatContainerVisible("c", "$1")}))`,
      [ownerId, destinationId],
    )
  ).rows[0];
  return row ? assistantConversationDestination.parse(row) : null;
}

/**
 * Explicit first-party open only, inside the caller's primary transaction.
 * Serialize creation by owner, so two devices obtain the same generation.
 * Never adopts an old chat or restores a deleted/swept destination.
 */
export async function openPersonalConversation(
  db: Queryable,
  ownerId: string,
): Promise<AssistantConversationDestination> {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `assistant-personal-conversation:${ownerId}`,
  ]);
  const owner = (
    await db.query(
      "SELECT id FROM users WHERE id=$1 AND NOT disabled FOR SHARE",
      [ownerId],
    )
  ).rows[0];
  if (!owner) fail(404, "Conversation not found.");
  const existing = (
    await db.query<StreamRow>(
      `SELECT ${fields} FROM assistant_conversation_streams s
     WHERE s.owner_id=$1 AND s.personal AND s.retired_at IS NULL FOR UPDATE`,
      [ownerId],
    )
  ).rows[0];
  if (existing) {
    const visible = await conversationDestination(db, ownerId, existing.id);
    if (!visible) fail(409, "This conversation is unavailable.");
    return visible;
  }
  const chatId = randomUUID();
  await db.query(
    `INSERT INTO ai_chats(id,user_id,title,origin,pinned)
     VALUES($1,$2,'Orbyn','person',true)`,
    [chatId, ownerId],
  );
  const made = (
    await db.query<StreamRow>(
      `INSERT INTO assistant_conversation_streams(owner_id,chat_id,personal)
     VALUES($1,$2,true) RETURNING id,chat_id,personal,last_sequence::text,read_sequence::text`,
      [ownerId, chatId],
    )
  ).rows[0];
  return assistantConversationDestination.parse(made);
}

/**
 * Enable a conversation explicitly selected as a work origin. Caller owns the
 * admission transaction. Missing/inaccessible destinations never fall back.
 */
export async function registerOriginConversation(
  db: Queryable,
  ownerId: string,
  chatId: string,
): Promise<AssistantConversationDestination> {
  const chat = (
    await db.query(
      `SELECT c.id FROM ai_chats c JOIN users u ON u.id=c.user_id
     WHERE c.id=$2 AND NOT u.disabled AND c.swept_at IS NULL
       AND ${conversationExecutionChatVisible("c", "$1")} FOR UPDATE OF c`,
      [ownerId, chatId],
    )
  ).rows[0];
  if (!chat) fail(404, "Conversation not found.");
  await db.query(
    `INSERT INTO assistant_conversation_streams(owner_id,chat_id)
     VALUES($1,$2) ON CONFLICT(chat_id) DO NOTHING`,
    [ownerId, chatId],
  );
  const row = (
    await db.query<StreamRow>(
      `SELECT ${fields} FROM assistant_conversation_streams s
     WHERE s.owner_id=$1 AND s.chat_id=$2 AND s.retired_at IS NULL FOR UPDATE`,
      [ownerId, chatId],
    )
  ).rows[0];
  if (!row) fail(409, "This conversation is unavailable.");
  return assistantConversationDestination.parse(row);
}

/**
 * Chat owner calls this in the same transaction as saving a turn. This retained
 * record is authoritative after ai_chats' execution window drops the turn.
 * Only already-enabled streams participate: legacy execution chats stay intact.
 */
export async function retainConversationTurn(
  db: Queryable,
  ownerId: string,
  chatId: string,
  value: SavedChatTurn,
) {
  if (!value.turn_id) return;
  // Lock the chat before its stream, matching admission/deletion lock order.
  const stream = (
    await db.query<{ id: string }>(
      `SELECT s.id FROM ai_chats c JOIN assistant_conversation_streams s ON s.chat_id=c.id
     WHERE c.id=$2 AND c.user_id=$1 AND s.owner_id=$1
       AND c.swept_at IS NULL AND s.retired_at IS NULL FOR UPDATE OF c,s`,
      [ownerId, chatId],
    )
  ).rows[0];
  if (!stream) return;
  const turn = savedChatTurn.parse(value);
  const existing = (
    await db.query<{ id: string }>(
      `SELECT id FROM assistant_conversation_entries
     WHERE destination_id=$1 AND turn_id=$2 AND role=$3`,
      [stream.id, turn.turn_id, turn.role],
    )
  ).rows[0];
  let entryId: string;
  if (existing) {
    entryId = existing.id;
    await db.query(
      `UPDATE assistant_conversation_entries SET payload=$2::jsonb,
       revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND payload IS DISTINCT FROM $2::jsonb`,
      [entryId, JSON.stringify(turn)],
    );
  } else {
    const next = (
      await db.query<{ sequence: string }>(
        `UPDATE assistant_conversation_streams SET last_sequence=last_sequence+1
       WHERE id=$1 RETURNING last_sequence::text AS sequence`,
        [stream.id],
      )
    ).rows[0];
    entryId = randomUUID();
    await db.query(
      `INSERT INTO assistant_conversation_entries(id,destination_id,sequence,kind,turn_id,role,payload,sources_checked)
       VALUES($1,$2,$3,'turn',$4,$5,$6::jsonb,true)`,
      [
        entryId,
        stream.id,
        next.sequence,
        turn.turn_id,
        turn.role,
        JSON.stringify(turn),
      ],
    );
  }
  // Source dependencies remain per-entry; never union them onto the stream.
  // Repeated saves may add dependencies, never erase previous provenance.
  await db.query(
    `INSERT INTO assistant_conversation_entry_sources(entry_id,source_kind,source_id)
     SELECT $1,source_kind,source_id FROM assistant_chat_sources
     WHERE chat_id=$2 AND turn_id=$3 ON CONFLICT DO NOTHING`,
    [entryId, chatId, turn.turn_id],
  );
  if (turn.role === "assistant")
    await db.query(
      `UPDATE assistant_conversation_entries SET sources_checked=EXISTS(
       SELECT 1 FROM ai_jobs j WHERE j.user_id=$2 AND j.chat_id=$3
         AND j.turn_id=$4 AND j.sources_checked) WHERE id=$1`,
      [entryId, ownerId, chatId, turn.turn_id],
    );
}
