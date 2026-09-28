import type { SystemRole } from "@orbyn/core";
import { pool, transaction } from "../db/pool.js";
import { startAssistantAutomation } from "../modules/ai/agent/run.js";
import { resolveAi } from "../modules/ai/providers/resolve.js";
import type { ResolvedAi } from "../modules/ai/providers/adapters.js";
import {
  FAILED_RETRY_HOURS,
  MAX_AUTOMATION_ATTEMPTS,
  STALE_RUN_MINUTES,
  assistantActive,
} from "./assistant-scan.js";

/** A claim that never queued a job (the worker stopped) is retried after this. */
const CLAIM_RETRY_MINUTES = 30;
const TASK_BATCH = 10;
/** The most notes and checklist lines a run's message carries. */
const NOTES_CHARS = 4000;
const STEP_LINES = 40;

type TaskDue = {
  id: string;
  user_id: string;
  role: SystemRole;
  title: string;
  notes: string;
  due_at: Date | null;
  timezone: string;
  team_name: string | null;
  project_name: string | null;
  claimed_at: Date;
};

/**
 * SQL true when the handed task on `i` may be claimed for a run: its last
 * job never queued (after a while), failed (a few hours later, a few tries
 * in all), died with its worker, or is gone. A run working or waiting on
 * the person holds it.
 */
const taskClaimable = (i: string, now: string) => `(
  ${i}.agent_attempts < ${MAX_AUTOMATION_ATTEMPTS} AND (
    (${i}.agent_job_id IS NULL AND (${i}.agent_claimed_at IS NULL
      OR ${i}.agent_claimed_at < ${now}::timestamptz - make_interval(mins => ${CLAIM_RETRY_MINUTES})))
    OR (${i}.agent_job_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ai_jobs hj WHERE hj.id = ${i}.agent_job_id AND (
        hj.state = 'waiting'
        OR (hj.state = 'running' AND hj.heartbeat_at >=
              ${now}::timestamptz - make_interval(mins => ${STALE_RUN_MINUTES}))
        OR (hj.state = 'failed' AND ${i}.agent_claimed_at >=
              ${now}::timestamptz - make_interval(hours => ${FAILED_RETRY_HOURS}))
        OR hj.state = 'done')))))`;

/** SQL true when the task's project is kept out of the assistant. */
const keptOut = (i: string) =>
  `EXISTS (SELECT 1 FROM projects ko WHERE ko.id = ${i}.project_id AND ko.assistant_off)`;

/**
 * Hand back tasks the agent can't work on: every try used up, or moved into
 * a project kept out of the assistant since. Each comes back to the person
 * saying so.
 */
async function giveUp(now: Date, only: string[] | null) {
  await pool.query(
    `UPDATE items i SET agent_grant_id = NULL, agent_state = 'needs_you',
       agent_claimed_at = NULL, updated_at = now(),
       agent_result = CASE WHEN ${keptOut("i")}
         THEN 'This task''s project is kept out of the assistant, so it came back to you.'
         ELSE 'This task couldn''t be finished after a few tries, so it came back to you.' END
      FROM agent_grants g
     WHERE g.id = i.agent_grant_id
       AND ($2::uuid[] IS NULL OR g.user_id = ANY($2::uuid[]))
       AND (${keptOut("i")} OR (i.agent_attempts >= ${MAX_AUTOMATION_ATTEMPTS}
         AND NOT EXISTS (SELECT 1 FROM ai_jobs hj WHERE hj.id = i.agent_job_id
           AND (hj.state = 'waiting' OR (hj.state = 'running' AND hj.heartbeat_at >=
             $1::timestamptz - make_interval(mins => ${STALE_RUN_MINUTES}))))))`,
    [now, only],
  );
}

/** The run's message: the task's title, notes and checklist, and what to do. */
async function messageFor(task: TaskDue) {
  const steps = (
    await pool.query<{ title: string; done: boolean }>(
      `SELECT title, done FROM item_steps WHERE item_id = $1
        ORDER BY position, created_at LIMIT ${STEP_LINES}`,
      [task.id],
    )
  ).rows;
  return [
    `I've handed you my task “${task.title}” (task:${task.id}). Complete it if you can, or move it as far forward as you can.`,
    task.notes.trim()
      ? `Notes:\n${task.notes.trim().slice(0, NOTES_CHARS)}`
      : "",
    steps.length
      ? `Checklist:\n${steps.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}`
      : "",
    [
      task.due_at ? `Due: ${task.due_at.toISOString()}` : "",
      task.project_name ? `Project: ${task.project_name}` : "",
      task.team_name ? `Team: ${task.team_name}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "Do the work with your tools: draft what it needs, tick checklist steps you finish, and mark the task done only when it really is. Follow your saved approval scopes. Finish with one short sentence saying what you did, or what you need from me.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Claim and start runs for tasks handed to the person's agent (W3), without
 * holding a lock during the model call. Nothing is claimed without an AI
 * provider; a paused assistant's tasks wait.
 */
export async function scanAssistantTasks(
  now = new Date(),
  options: {
    limit?: number;
    only?: string[];
    ai?: ResolvedAi | null;
    startAutomation?: typeof startAssistantAutomation;
  } = {},
) {
  const ai = options.ai === undefined ? await resolveAi() : options.ai;
  if (!ai) return 0;
  const only = options.only ?? null;
  await giveUp(now, only);
  const limit = Math.max(1, Math.min(options.limit ?? TASK_BATCH, 50));
  const tasks = await transaction(async (db) => {
    const rows = (
      await db.query<Omit<TaskDue, "claimed_at">>(
        `SELECT i.id, g.user_id, u.role, i.title, i.notes, i.due_at,
                coalesce(pp.timezone, 'UTC') AS timezone,
                t.name AS team_name, p.name AS project_name
           FROM items i
           JOIN agent_grants g ON g.id = i.agent_grant_id AND g.kind = 'assistant'
             AND g.revoked_at IS NULL
           JOIN users u ON u.id = g.user_id AND NOT u.disabled
           LEFT JOIN planner_prefs pp ON pp.user_id = g.user_id
           LEFT JOIN teams t ON t.id = i.team_id
           LEFT JOIN projects p ON p.id = i.project_id
          WHERE i.agent_state IN ('queued', 'working')
            AND ${assistantActive("g.user_id")}
            AND NOT ${keptOut("i")}
            AND ${taskClaimable("i", "$1")}
            AND ($2::uuid[] IS NULL OR g.user_id = ANY($2::uuid[]))
          ORDER BY i.agent_claimed_at NULLS FIRST, i.updated_at, i.id
          LIMIT $3
          FOR UPDATE OF i SKIP LOCKED`,
        [now, only, limit],
      )
    ).rows;
    for (const row of rows)
      await db.query(
        `UPDATE items SET agent_claimed_at = $2, agent_job_id = NULL,
           agent_state = 'queued', agent_attempts = agent_attempts + 1
         WHERE id = $1`,
        [row.id, now],
      );
    return rows.map((row) => ({ ...row, claimed_at: now }));
  });

  let started = 0;
  for (const task of tasks) {
    try {
      const jobId = await (options.startAutomation ?? startAssistantAutomation)(
        {
          userId: task.user_id,
          message: await messageFor(task),
          timezone: task.timezone,
          automation: { kind: "task", id: task.id },
          title: `Task: ${task.title}`,
          onQueued: async (db, id) => {
            // Taken back meanwhile: no run starts.
            const queued = await db.query(
              `UPDATE items SET agent_job_id = $2, agent_state = 'working',
                 agent_result = NULL, updated_at = now()
               WHERE id = $1 AND agent_claimed_at = $3
                 AND agent_grant_id IS NOT NULL`,
              [task.id, id, task.claimed_at],
            );
            if (!queued.rowCount)
              throw new Error("The task was taken back before its run queued.");
          },
        },
      );
      if (jobId) started++;
    } catch {
      // The claim times out and the task is tried again (attempts are capped).
    }
  }
  return started;
}
