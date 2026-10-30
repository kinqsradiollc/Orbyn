import {
  assistantRoutineRunsPage,
  assistantRoutineRunsQuery,
  fail,
  type AssistantRoutineRun,
  type AssistantRoutineRunsPage,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantJobSourcesVisible } from "../../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../../lib/assistant-visibility.js";
import { projectOutcomeReceipt } from "../ai/outcome-receipts.js";

/** Called only inside the scheduler's existing atomic job/claim transaction. */
export async function recordRoutineRun(
  db: Queryable,
  owner: string,
  routine: string,
  scheduledFor: Date | string,
  job: string,
) {
  // A duplicate occurrence must reject the whole admission, not orphan another job.
  await db.query(
    `INSERT INTO assistant_routine_runs(owner_id,routine_id,scheduled_for,job_id,state)
     VALUES($1,$2,$3,$4,'queued')`,
    [owner, routine, scheduledFor, job],
  );
}

export async function readRoutineRuns(
  db: Queryable,
  owner: string,
  routine: string,
  raw: unknown,
): Promise<AssistantRoutineRunsPage> {
  const query = assistantRoutineRunsQuery.parse(raw);
  if (
    !(
      await db.query(
        "SELECT id FROM agent_routines WHERE id=$2 AND user_id=$1",
        [owner, routine],
      )
    ).rowCount
  )
    fail(404, "Assistant routine not found.");
  const [beforeTime, beforeId] = query.cursor?.split("|") ?? [];
  const rows = (
    await db.query<{
      id: string;
      scheduled_for: string;
      state: AssistantRoutineRun["state"];
      last_observed_at: Date;
      resume_count: number;
      job_id: string | null;
      chat_id: string | null;
      summary: string | null;
      execution_outcome: unknown;
      goal_acceptance: unknown;
      review_status: string | null;
    }>(
      `SELECT r.id,to_char(r.scheduled_for AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS scheduled_for,
       r.state,r.last_observed_at,r.resume_count,j.id AS job_id,j.chat_id,
       left(j.result->>'answer',2000) AS summary,
       j.result->'assistant_run'->'execution_outcome' AS execution_outcome,(SELECT accepted.acceptance FROM assistant_goal_executions accepted WHERE accepted.owner_id=$1 AND accepted.state='completed' AND accepted.acceptance->>'job_id'=j.id::text LIMIT 1) AS goal_acceptance,
       CASE WHEN p.status='pending' AND p.expires_at<=now() THEN 'expired' ELSE p.status END AS review_status
       FROM assistant_routine_runs r
       LEFT JOIN ai_jobs j ON j.id=r.job_id AND ${assistantJobSourcesVisible("j", "$1", false)}
         AND EXISTS(SELECT 1 FROM ai_chats c WHERE c.id=j.chat_id AND ${assistantChatVisible("c", "$1")})
       LEFT JOIN proposals p ON p.user_id=$1 AND p.id=CASE
         WHEN j.result->'assistant_run'->>'proposal_id' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
         THEN (j.result->'assistant_run'->>'proposal_id')::uuid END
       WHERE r.owner_id=$1 AND r.routine_id=$2
         AND ($3::timestamptz IS NULL OR (r.scheduled_for,r.id)<($3::timestamptz,$4::uuid))
       ORDER BY r.scheduled_for DESC,r.id DESC LIMIT $5`,
      [owner, routine, beforeTime ?? null, beforeId ?? null, query.limit + 1],
    )
  ).rows;
  const selected = rows.slice(0, query.limit);
  const last = selected.at(-1);
  return assistantRoutineRunsPage.parse({
    routine_id: routine,
    runs: selected.map((row): AssistantRoutineRun => {
      const metadata = {
        id: row.id,
        scheduled_for: row.scheduled_for,
        state: row.state,
        last_observed_at: row.last_observed_at.toISOString(),
        resume_count: row.resume_count,
      };
      if (!row.job_id || !row.chat_id)
        return { ...metadata, visibility: "restricted" };
      const receipt = projectOutcomeReceipt(
        row.execution_outcome,
        row.job_id,
        row.review_status,
        row.goal_acceptance,
      );
      return {
        ...metadata,
        visibility: "available",
        job_id: row.job_id,
        chat_id: row.chat_id,
        summary: row.summary,
        ...(receipt ? { execution_outcome: receipt } : {}),
      };
    }),
    next_cursor:
      rows.length > query.limit && last
        ? `${last.scheduled_for}|${last.id}`
        : null,
  });
}
