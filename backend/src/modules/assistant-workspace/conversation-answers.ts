import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assistantConversationAnswer,
  assistantConversationAnswerInput,
  fail,
} from "@orbyn/core";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { answerAssistantQuestion } from "../ai/agent/run.js";
import {
  conversationDestination,
  retainConversationTurn,
} from "./conversation-storage.js";
import { conversationEntryVisible } from "./conversation-feed.js";
import { conversationWaitingKind } from "./conversation-questions.js";

const question = z.object({
  event: z.literal("question"),
  work: z.object({ kind: z.literal("job"), id: z.uuid() }),
  waiting_id: z.uuid(),
});

/** Resume exactly one existing job and retain its answer in the same transaction. */
export async function answerConversationQuestion(
  db: Db,
  user: UserRow,
  destinationId: string,
  entryId: string,
  value: unknown,
  log: FastifyBaseLogger,
) {
  const input = assistantConversationAnswerInput.parse(value);
  // Lock both chats in a deterministic order before either stream or job. The
  // old Details endpoint also locks its execution chat before consuming a job.
  await db.query(
    `SELECT c.id FROM ai_chats c WHERE c.user_id=$1 AND (c.id IN (
      SELECT s.chat_id FROM assistant_conversation_streams s WHERE s.id=$2 AND s.owner_id=$1
    ) OR c.id IN (
      SELECT j.chat_id FROM ai_jobs j JOIN assistant_conversation_entries e
        ON j.id::text=e.payload->'work'->>'id'
        WHERE e.id=$3 AND e.destination_id=$2 AND j.user_id=$1
    )) ORDER BY c.id FOR UPDATE`,
    [user.id, destinationId, entryId],
  );
  await db.query(
    "SELECT id FROM assistant_conversation_streams WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [destinationId, user.id],
  );
  const destination = await conversationDestination(db, user.id, destinationId);
  if (!destination) fail(404, "Conversation not found.");
  const target = (
    await db.query<{ payload: unknown; waiting_kind: string | null }>(
      `SELECT e.payload,${conversationWaitingKind("e.payload", "$1")} AS waiting_kind
     FROM assistant_conversation_entries e WHERE e.id=$3 AND e.destination_id=$2 AND ${conversationEntryVisible()}`,
      [user.id, destinationId, entryId],
    )
  ).rows[0];
  if (!target) fail(404, "Update is no longer available.");
  const parsed = question.safeParse(target.payload);
  if (!parsed.success) fail(409, "Open this request in Review.");
  const q = parsed.data;
  const hash = createHash("sha256").update(input.answer).digest("hex");
  const receipt = (
    await db.query<{
      question_entry_id: string;
      answer_entry_id: string;
      job_id: string;
      waiting_id: string;
      answer_hash: string;
    }>(
      "SELECT * FROM assistant_conversation_answers WHERE destination_id=$1 AND turn_id=$2",
      [destinationId, input.turn_id],
    )
  ).rows[0];
  const result = (answerEntryId: string) =>
    assistantConversationAnswer.parse({
      accepted: true,
      job_id: q.work.id,
      turn_id: input.turn_id,
      entry_id: answerEntryId,
      destination_id: destinationId,
      reply_to_entry_id: entryId,
    });
  if (receipt) {
    if (
      receipt.question_entry_id !== entryId ||
      receipt.job_id !== q.work.id ||
      receipt.waiting_id !== q.waiting_id ||
      receipt.answer_hash !== hash
    )
      fail(409, "This reply ID was already used for a different answer.");
    return result(receipt.answer_entry_id);
  }
  if (target.waiting_kind !== "person")
    fail(
      409,
      target.waiting_kind === "approval"
        ? "Open this request in Review."
        : "This question changed or was answered. Refresh before answering.",
    );
  if (
    (
      await db.query(
        "SELECT id FROM assistant_conversation_entries WHERE destination_id=$1 AND turn_id=$2",
        [destinationId, input.turn_id],
      )
    ).rowCount
  )
    fail(409, "This reply ID is already in use.");
  await answerAssistantQuestion(
    q.work.id,
    user,
    { answer: input.answer, waiting_id: q.waiting_id },
    log,
    db,
    input.turn_id,
  );
  await db.query(
    `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
     SELECT $1,$2,source_kind,source_id FROM assistant_conversation_entry_sources WHERE entry_id=$3 ON CONFLICT DO NOTHING`,
    [destination.chat_id, input.turn_id, entryId],
  );
  await retainConversationTurn(db, user.id, destination.chat_id, {
    role: "user",
    text: input.answer,
    turn_id: input.turn_id,
  });
  const answer = (
    await db.query<{ id: string }>(
      "UPDATE assistant_conversation_entries SET reply_to_entry_id=$3 WHERE destination_id=$1 AND turn_id=$2 AND role='user' RETURNING id",
      [destinationId, input.turn_id, entryId],
    )
  ).rows[0];
  if (!answer) fail(409, "Conversation is no longer available.");
  await db.query(
    `INSERT INTO assistant_conversation_answers(destination_id,turn_id,question_entry_id,answer_entry_id,job_id,waiting_id,answer_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      destinationId,
      input.turn_id,
      entryId,
      answer.id,
      q.work.id,
      q.waiting_id,
      hash,
    ],
  );
  return result(answer.id);
}
