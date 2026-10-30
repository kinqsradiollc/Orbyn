import {
  fail,
  goalExecutionOutput,
  type GoalExecutionOutput,
} from "@orbyn/core";
import type { Queryable } from "../../../db/pool.js";
import { transaction } from "../../../db/pool.js";
import type { PlanStep } from "../../../capabilities/plan-run.js";
import type { AssistantAutomation } from "./run.js";
import { assertAssistantLease } from "./lease.js";
import { assistantSourceVisible } from "../../../lib/assistant-source-visibility.js";
import {
  visibleItems,
  visibleDocs,
  visibleProjects,
} from "../../../lib/visibility.js";
import {
  lockGoalExecution,
  assertGoalExecutionCurrent,
} from "../../assistant-workspace/goal-executions.js";

export type GoalExecutionBinding = {
  id: string;
  unit_id: string;
  criterion_id: string;
  generation: number;
  mode: "work" | "verify" | "repair";
  effect_ceiling: "suggest" | "existing_scopes";
  job_ids: string[];
  outputs: GoalExecutionOutput[];
};
export { goalExecutionDigest as goalEvidenceDigest } from "../../assistant-workspace/goal-executions.js";
import { goalExecutionDigest } from "../../assistant-workspace/goal-executions.js";
const uuid = /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i;

/** Job lock must precede the execution lock, including at provider boundaries. */
export async function checkGoalExecutionBoundary(
  owner: string,
  jobId: string,
  automation?: AssistantAutomation,
  db?: Queryable,
  steps?: PlanStep[],
) {
  const binding = automation?.goal_execution;
  if (!binding) return;
  const check = async (current: Queryable) => {
    await assertAssistantLease(jobId, current, true);
    const execution = await lockGoalExecution(current, owner, binding.id);
    await assertGoalExecutionCurrent(current, owner, execution, {
      generation: binding.generation,
      jobId,
      unitId: binding.unit_id,
      mode: binding.mode,
      write: steps !== undefined,
    });
    const unit = execution.units.find((row) => row.id === binding.unit_id);
    if (
      !unit ||
      unit.criterion_id !== binding.criterion_id ||
      execution.effect_ceiling !== binding.effect_ceiling
    )
      fail(409, "The goal work scope changed. Review the current execution.");
    if (
      goalExecutionDigest(binding.outputs) !== goalExecutionDigest(unit.outputs)
    )
      fail(409, "The bound goal outputs changed.");
    const actualOutputs = unit.outputs.filter(
      (output) => output.kind !== "response",
    );
    if (
      actualOutputs.length &&
      !(
        await current.query(
          `SELECT NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($2::jsonb) o(kind text,id uuid) WHERE NOT ${assistantSourceVisible("o.kind", "o.id", "$1")}) AS visible`,
          [
            owner,
            JSON.stringify(actualOutputs.map(({ kind, id }) => ({ kind, id }))),
          ],
        )
      ).rows[0]?.visible
    )
      fail(409, "The goal outputs are no longer available.");
    if (!steps?.length) return;
    if (binding.mode === "verify") fail(409, "Goal verification is read-only.");
    if (!unit.effects_applied) return;
    // A consumed creation unit can repair its own versioned outputs, never create
    // another object by changing the title or assigning a fresh job/client_ref.
    const targets = new Set(
      unit.outputs
        .filter((out) => out.kind !== "response")
        .map(
          (out) =>
            `${out.kind}:${out.id.match(uuid)?.[0]?.toLowerCase() ?? out.id}`,
        ),
    );
    const validate = (kind: string, value: unknown, version: unknown) => {
      const ref =
        typeof value === "string"
          ? value.match(uuid)?.[0]?.toLowerCase()
          : undefined;
      if (
        !ref ||
        !targets.has(`${kind}:${ref}`) ||
        !Number.isSafeInteger(version) ||
        Number(version) < 1
      )
        fail(
          409,
          "Repair must use an existing goal output and its current version.",
        );
    };
    for (const step of steps) {
      if (step.tool === "edit_doc")
        validate("doc", step.args.doc, step.args.version);
      else if (
        step.tool === "update_tasks" &&
        Array.isArray(step.args.changes)
      ) {
        for (const value of step.args.changes) {
          const change = value as Record<string, unknown>;
          validate("task", change.id, change.version);
          if (change.project || change.team || change.scope || change.agent)
            fail(
              409,
              "Moving goal outputs or delegating them needs separate Review.",
            );
        }
      } else
        fail(
          409,
          "This goal output cannot be repaired automatically with that action. Review the saved work.",
        );
    }
  };
  if (db) await check(db);
  else await transaction(check);
}

/** Only committed capability targets, read in the SAME effect transaction, bind outputs. */
export async function captureGoalOutputs(
  db: Queryable,
  owner: string,
  jobId: string,
  targets: string[],
  structured: unknown,
): Promise<GoalExecutionOutput[]> {
  const ids = [
    ...new Set(
      targets.flatMap((target) => target.match(uuid)?.[0]?.toLowerCase() ?? []),
    ),
  ].slice(0, 100);
  if (!ids.length) return [];
  const rows = await db.query<{
    kind: "task" | "doc" | "project";
    id: string;
    version: string;
  }>(
    `SELECT 'task' AS kind,i.id,i.version::text FROM items i WHERE i.id=ANY($2::uuid[]) AND ${visibleItems("i", { user: "$1", ai: true })}
     UNION ALL SELECT 'doc',d.id,d.version::text FROM docs d WHERE d.id=ANY($2::uuid[]) AND ${visibleDocs("d", { user: "$1", ai: true })}
     UNION ALL SELECT 'project',p.id,to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM projects p WHERE p.id=ANY($2::uuid[]) AND ${visibleProjects("p", { user: "$1", ai: true })}`,
    [owner, ids],
  );
  const receipt_digest = goalExecutionDigest(structured);
  const outputs = rows.rows.map((row) =>
    goalExecutionOutput.parse({
      ...row,
      producer_job_id: jobId,
      receipt_digest,
    }),
  );
  if (outputs.length) {
    await db.query(
      `INSERT INTO assistant_job_sources(job_id,source_kind,source_id)
      SELECT $1,o.kind,o.id FROM jsonb_to_recordset($2::jsonb) o(kind text,id uuid) ON CONFLICT DO NOTHING`,
      [jobId, JSON.stringify(outputs.map(({ kind, id }) => ({ kind, id })))],
    );
    await db.query(
      `INSERT INTO assistant_chat_sources(chat_id,turn_id,source_kind,source_id)
      SELECT j.chat_id,j.turn_id,s.source_kind,s.source_id FROM ai_jobs j JOIN assistant_job_sources s ON s.job_id=j.id
      WHERE j.id=$1 AND j.user_id=$2 AND j.chat_id IS NOT NULL AND j.turn_id IS NOT NULL ON CONFLICT DO NOTHING`,
      [jobId, owner],
    );
  }
  return outputs;
}
