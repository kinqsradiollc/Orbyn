import { fail } from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import {
  conversationDestination,
  retainConversationTurn,
} from "./conversation-storage.js";
import { deliveryBindingVisible } from "./conversation-delivery.js";

/** Used by both the conversation route and the existing work-view answer path. */
export async function retainWorkQuestionAnswer(
  db: Db,
  owner: string,
  jobId: string,
  executionChat: string,
  turnId: string,
  text: string,
  waitingId: string,
) {
  const binding = (
    await db.query<{ destination_id: string; allowed: boolean }>(
      `SELECT b.destination_id,${deliveryBindingVisible("b", "$1")} AS allowed
     FROM assistant_delivery_bindings b WHERE b.owner_id=$1 AND b.work_kind='job' AND b.work_id=$2`,
      [owner, jobId],
    )
  ).rows[0];
  let destinationChat: string | null = null;
  if (binding) {
    if (!binding.allowed) fail(404, "This work is no longer available.");
    const destination = await conversationDestination(
      db,
      owner,
      binding.destination_id,
    );
    if (!destination)
      fail(409, "The originating conversation is no longer available.");
    destinationChat = destination.chat_id;
  }
  for (const chat of new Set(
    [executionChat, destinationChat].filter(
      (chat): chat is string => chat !== null,
    ),
  )) {
    await db.query(
      `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
       SELECT $1,$2,source_kind,source_id FROM assistant_job_sources WHERE job_id=$3 ON CONFLICT DO NOTHING`,
      [chat, turnId, jobId],
    );
    await retainConversationTurn(db, owner, chat, {
      role: "user",
      text,
      turn_id: turnId,
    });
  }
  if (binding)
    await db.query(
      `UPDATE assistant_conversation_entries answer SET reply_to_entry_id=question.id
     FROM assistant_conversation_entries question
     WHERE answer.destination_id=$1 AND answer.turn_id=$2 AND answer.role='user'
       AND question.destination_id=$1 AND question.payload->>'event'='question'
       AND question.payload->'work'->>'kind'='job' AND question.payload->'work'->>'id'=$3
       AND question.payload->>'waiting_id'=$4`,
      [binding.destination_id, turnId, jobId, waitingId],
    );
}
