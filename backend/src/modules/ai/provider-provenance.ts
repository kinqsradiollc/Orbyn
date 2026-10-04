import { transaction, type Db } from "../../db/pool.js";
import { appendChatTrace } from "./chats.js";
import { assertJobAiProviderChoice } from "../auth/ai-provider-choice.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
/** Existing trace fields keep older clients compatible; labels are display metadata only. */
export async function recordProviderUse(
  owner: string,
  jobId: string,
  source: "chatgpt" | "default",
  model: string,
  fallback: boolean,
  phase: "started" | "completed",
  operationId?: string,
  sharedDb?: Db,
) {
  const record = async (db: Db) => {
    await assertJobAiProviderChoice(db, owner, jobId);
    const row = (
      await db.query(
        `SELECT j.chat_id,j.turn_id FROM ai_jobs j WHERE j.id=$1 AND j.user_id=$2 AND ${assistantJobSourcesVisible("j", "$2", false)}`,
        [jobId, owner],
      )
    ).rows[0];
    if (!row?.chat_id || !row.turn_id) return;
    const prefix = source === "chatgpt" ? "pc" : fallback ? "pf" : "pd";
    const tool = `${prefix}_${phase === "completed" ? "c" : "s"}${operationId ? `:${operationId}` : ""}`;
    const chat = (
      await db.query(
        "SELECT trace FROM ai_chats WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [row.chat_id, owner],
      )
    ).rows[0];
    if (!chat) return;
    const name =
      source === "chatgpt"
        ? "ChatGPT"
        : fallback
          ? "Orbyn fallback"
          : "Orbyn default";
    const label = `${name} · ${model} · ${phase}`.slice(0, 180);
    if (
      Array.isArray(chat.trace) &&
      chat.trace.some(
        (e: any) =>
          e.turn_id === row.turn_id && e.tool === tool && e.label === label,
      )
    )
      return;
    await appendChatTrace(
      owner,
      row.chat_id,
      {
        turn_id: row.turn_id,
        step: 1,
        kind: phase === "completed" ? "result" : "thinking",
        tool,
        label,
        at: new Date().toISOString(),
      },
      db,
    );
  };
  if (sharedDb) return record(sharedDb);
  return transaction(record);
}
