import {
  fail,
  goalExecutionHistoryQuery,
  goalExecutionPage,
  goalExecutionAttemptPage,
  readAssistantOutcome,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { firstParty } from "../proposals/service.js";
import { projectOutcomeReceipt } from "../ai/outcome-receipts.js";
import {
  startGoalExecution,
  controlGoalExecution,
  readGoalExecution,
  publicMetadata,
  goalFacts,
  type GoalExecutionRow,
} from "./goal-executions.js";
import {
  attempts,
  authorizedJobs,
  goalExecutionDetailsFor,
  type AttemptRow,
} from "./goal-execution-evidence.js";
export async function goalExecutionRoutes(app: FastifyInstance) {
  app.post("/me/goals/:id/executions", async (r, reply) => {
    const user = await firstParty(r);
    const id = await transaction((db) =>
      startGoalExecution(db, user.id, idParam(r), r.body),
    );
    reply.code(201);
    return transaction((db) => goalExecutionDetailsFor(db, user.id, id));
  });
  app.get("/me/goals/:id/executions", async (r) => {
    const user = await authenticate(r),
      goalId = idParam(r),
      q = goalExecutionHistoryQuery.parse(r.query);
    return transaction(async (db) => {
      if (
        !(
          await db.query("SELECT id FROM goals WHERE id=$2 AND user_id=$1", [
            user.id,
            goalId,
          ])
        ).rowCount
      )
        fail(404, "Goal not found.");
      const [time, id] = q.cursor?.split("|") ?? [];
      const rows = (
        await db.query<GoalExecutionRow & { cursor_time: string }>(
          `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM assistant_goal_executions WHERE owner_id=$1 AND goal_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
          [user.id, goalId, time ?? null, id ?? null, q.limit + 1],
        )
      ).rows;
      const selected = rows.slice(0, q.limit),
        last = selected.at(-1);
      return goalExecutionPage.parse({
        goal_id: goalId,
        executions: selected.map(publicMetadata),
        next_cursor:
          rows.length > q.limit && last
            ? `${last.cursor_time}|${last.id}`
            : null,
      });
    });
  });
  app.get("/me/goal-executions/:id", async (r) => {
    const user = await authenticate(r);
    return transaction((db) =>
      goalExecutionDetailsFor(db, user.id, idParam(r)),
    );
  });
  app.get("/me/goal-executions/:id/attempts", async (r) => {
    const user = await authenticate(r),
      q = goalExecutionHistoryQuery.parse(r.query);
    return transaction(async (db) => {
      const row = await readGoalExecution(db, user.id, idParam(r));
      if (!row) fail(404, "Goal execution not found.");
      const all = await attempts(db, row),
        jobs = (await goalFacts(db, user.id, row.goal_id, row.lane))
          ? await authorizedJobs(db, row, all)
          : new Map(),
        [time, id] = q.cursor?.split("|") ?? [];
      const rows = (
        await db.query<AttemptRow & { cursor_time: string }>(
          `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM assistant_goal_attempts WHERE execution_id=$1 AND owner_id=$2 AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid)) ORDER BY created_at DESC,id DESC LIMIT $5`,
          [row.id, user.id, time ?? null, id ?? null, q.limit + 1],
        )
      ).rows;
      const selected = rows.slice(0, q.limit),
        last = selected.at(-1);
      return goalExecutionAttemptPage.parse({
        execution_id: row.id,
        attempts: selected.map((a) => {
          const j = a.job_id ? jobs.get(a.job_id) : null;
          const base = {
            id: a.id,
            execution_id: a.execution_id,
            unit_id: a.unit_id,
            ordinal: a.ordinal,
            mode: a.mode,
            relation: a.relation,
            generation: a.generation,
            state: j?.state ?? a.state,
            allocated_tokens: a.allocated_tokens,
            settled_tokens: a.settled_tokens,
            created_at: a.created_at.toISOString(),
            settled_at: a.settled_at?.toISOString() ?? null,
          };
          return j
            ? {
                ...base,
                visibility: "available",
                job_id: j.id,
                chat_id: j.chat_id,
                summary:
                  typeof j.result?.answer === "string"
                    ? j.result.answer.slice(0, 4000)
                    : null,
                ...(readAssistantOutcome(
                  j.result?.assistant_run?.execution_outcome,
                )
                  ? {
                      execution_outcome: projectOutcomeReceipt(
                        j.result.assistant_run.execution_outcome,
                        j.id,
                        j.review_status,
                        row.acceptance,
                      ),
                    }
                  : {}),
              }
            : { ...base, visibility: "restricted" };
        }),
        next_cursor:
          rows.length > q.limit && last
            ? `${last.cursor_time}|${last.id}`
            : null,
      });
    });
  });
  for (const action of ["pause", "resume", "stop", "accept"] as const)
    app.post(`/me/goal-executions/:id/${action}`, async (r) => {
      const user = await firstParty(r),
        id = idParam(r);
      const result = await transaction((db) =>
        controlGoalExecution(db, user.id, id, action, r.body),
      );
      if (result.jobs.length) {
        const { stopAssistantJob } = await import("../ai/agent/run.js");
        for (const job of result.jobs)
          await stopAssistantJob(job, user, app.log);
      }
      return transaction((db) => goalExecutionDetailsFor(db, user.id, id));
    });
}
