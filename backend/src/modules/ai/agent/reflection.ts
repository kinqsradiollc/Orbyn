import { createHash } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "../../../db/pool.js";
import { assistantChatVisible } from "../../../lib/assistant-visibility.js";
import { assistantJobSourcesVisible } from "../../../lib/assistant-job-sources.js";
import { visibleItems } from "../../../lib/visibility.js";
import { assistantRunReview } from "../../assistant-workspace/overnight.js";

export const reflectionSources = z
  .array(
    z
      .object({
        kind: z.enum(["job", "task"]),
        id: z.uuid(),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  )
  .max(20);
export type ReflectionSource = z.output<typeof reflectionSources>[number];
export type ReflectionEvidence = {
  source: ReflectionSource;
  chat_id?: string;
  task_id?: string;
  title: string;
  facts: Record<string, unknown>;
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const revision = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Fresh, bounded evidence; persisted requests contain identities, never these private words. */
export async function reflectionEvidence(
  db: Queryable,
  userId: string,
  sources?: ReflectionSource[],
  now = new Date(),
): Promise<ReflectionEvidence[]> {
  if (sources) reflectionSources.parse(sources);
  const jobIds = sources?.filter((s) => s.kind === "job").map((s) => s.id);
  const taskIds = sources?.filter((s) => s.kind === "task").map((s) => s.id);
  const jobs = (
    await db.query<{
      id: string;
      chat_id: string;
      title: string;
      state: string;
      result: unknown;
      apply_result: unknown;
      waiting: unknown;
      run_origin: string;
      error_message: string | null;
    }>(
      `SELECT j.id,j.chat_id,c.title,j.state,j.result,j.apply_result,j.run_origin,j.error_message,
       j.run_state->'state'->'waiting' AS waiting
     FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
     WHERE j.state IN ('done','failed','waiting') AND ${assistantChatVisible("c", "$1")}
       AND ${assistantJobSourcesVisible("j", "$1", false)}
       AND NOT EXISTS(SELECT 1 FROM assistant_night_runs nr WHERE nr.job_id=j.id AND nr.kind='reflection')
       AND (($2::uuid[] IS NULL AND j.created_at >= $3::timestamptz-interval '36 hours' AND j.created_at <= $3)
         OR j.id=ANY($2::uuid[]))
     ORDER BY j.created_at DESC,j.id LIMIT 40`,
      [userId, jobIds ?? null, now],
    )
  ).rows;
  const result: ReflectionEvidence[] = [];
  for (const row of jobs) {
    const review = await assistantRunReview(db, userId, row);
    const answer = object(row.result).answer;
    const waiting = object(row.waiting);
    const facts = {
      state: row.state,
      origin: row.run_origin,
      failure:
        row.state === "failed"
          ? (row.error_message?.slice(0, 1000) ?? null)
          : null,
      summary:
        typeof answer === "string"
          ? answer.slice(0, 1600)
          : "No completed summary",
      question:
        row.state === "waiting" && typeof waiting.question === "string"
          ? waiting.question.slice(0, 1000)
          : null,
      waiting_for: row.state === "waiting" ? waiting.kind : null,
      review_status: review.proposal?.status ?? null,
      applied_changes: review.changes.filter(
        (change) => change.undo_until || change.undone_at,
      ).length,
      undone_changes: review.changes.filter((change) => change.undone_at)
        .length,
    };
    result.push({
      source: {
        kind: "job",
        id: row.id,
        revision: revision([row.title, facts]),
      },
      chat_id: row.chat_id,
      title: row.title,
      facts,
    });
  }
  const tasks = (
    await db.query<{
      id: string;
      title: string;
      status: string;
      version: number;
      notes: string;
      due_at: Date | null;
    }>(
      `SELECT i.id,i.title,i.status,i.version,i.notes,i.due_at FROM items i
     WHERE i.kind='task' AND ${visibleItems("i", { user: "$1", ai: true })}
       AND (($2::uuid[] IS NULL AND i.updated_at >= $3::timestamptz-interval '36 hours' AND i.updated_at <= $3)
         OR i.id=ANY($2::uuid[]))
     ORDER BY i.updated_at DESC,i.id LIMIT 40`,
      [userId, taskIds ?? null, now],
    )
  ).rows;
  const taskEvidence = tasks.map((row) => ({
    source: {
      kind: "task" as const,
      id: row.id,
      revision: revision([
        row.id,
        row.version,
        row.title,
        row.status,
        row.notes,
        row.due_at,
      ]),
    },
    task_id: row.id,
    title: row.title,
    facts: {
      status: row.status,
      notes: row.notes?.slice(0, 1200) ?? "",
      due_at: row.due_at?.toISOString() ?? null,
    },
  }));
  // Alternate categories so a busy run history cannot hide all task outcomes.
  const combined = Array.from(
    { length: Math.max(result.length, taskEvidence.length) },
    (_, i) =>
      [result[i], taskEvidence[i]].filter(Boolean) as ReflectionEvidence[],
  ).flat();
  if (!sources) return combined;
  return sources.flatMap((source) => {
    const current = combined.find(
      (entry) =>
        entry.source.kind === source.kind &&
        entry.source.id === source.id &&
        entry.source.revision === source.revision,
    );
    return current ? [current] : [];
  });
}

/** Exclude already claimed/completed revisions; a failed reflection can retry on a later night. */
export async function pendingReflectionSources(
  db: Queryable,
  userId: string,
  now: Date,
) {
  const evidence = await reflectionEvidence(db, userId, undefined, now);
  if (!evidence.length) return [];
  const consumed = new Set(
    (
      await db.query<{ key: string }>(
        `SELECT r.source_kind||':'||r.source_id||':'||r.revision AS key
     FROM assistant_reflection_receipts r JOIN ai_jobs j ON j.id=r.reflection_job_id
     WHERE r.user_id=$1 AND j.state <> 'failed'`,
        [userId],
      )
    ).rows.map((row) => row.key),
  );
  return evidence
    .filter(
      (entry) =>
        !consumed.has(
          `${entry.source.kind}:${entry.source.id}:${entry.source.revision}`,
        ),
    )
    .slice(0, 20)
    .map((entry) => entry.source);
}

/** Called in the scanner's serialized enqueue transaction, so all source claims are atomic. */
export async function claimReflectionSources(
  db: Queryable,
  userId: string,
  jobId: string,
  sources: ReflectionSource[],
) {
  for (const [index, source] of reflectionSources.parse(sources).entries()) {
    const claimed = await db.query(
      `INSERT INTO assistant_reflection_receipts(user_id,source_kind,source_id,revision,reflection_job_id,source_chat_id,position)
       VALUES($1,$2,$3,$4,$5,(SELECT chat_id FROM ai_jobs WHERE id=$3 AND user_id=$1 AND $2='job'),$6)
       ON CONFLICT(user_id,source_kind,source_id,revision) DO UPDATE
         SET reflection_job_id=EXCLUDED.reflection_job_id,source_chat_id=EXCLUDED.source_chat_id,position=EXCLUDED.position,created_at=now()
         WHERE EXISTS(SELECT 1 FROM ai_jobs j WHERE j.id=assistant_reflection_receipts.reflection_job_id AND j.state='failed')`,
      [userId, source.kind, source.id, source.revision, jobId, index + 1],
    );
    if (!claimed.rowCount)
      throw new Error("This evidence already has a reflection.");
  }
}
