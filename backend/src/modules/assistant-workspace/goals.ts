import {
  addDays,
  fail,
  goalInput,
  goalUpdate,
  localDateKey,
  weekdayOf,
  type Goal,
  type GoalCheckin,
} from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { visibleDocs, visibleProjects } from "../../lib/visibility.js";

type GoalRow = Omit<
  Goal,
  "created_at" | "updated_at" | "progress" | "target_date"
> & {
  created_at: Date;
  updated_at: Date;
  progress: Record<string, unknown> | null;
  target_date: string | null;
};
const GOAL_SELECT = `g.id, g.user_id, g.title, g.target, g.target_date::text AS target_date, g.plan_doc_id,
  d.title AS plan_title, g.project_id, p.name AS project_name, g.status,
  g.progress, g.created_at, g.updated_at`;
const ASSISTANT_VISIBLE_GOAL = `NOT EXISTS (
  SELECT 1 FROM projects hidden
   WHERE hidden.assistant_off AND (
     hidden.id = g.project_id OR EXISTS (
       SELECT 1 FROM docs plan WHERE plan.id = g.plan_doc_id AND plan.project_id = hidden.id
     )
   )
)`;
const goalOf = (row: GoalRow): Goal => ({
  ...row,
  progress: row.progress ?? {},
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});
async function visibleProject(
  db: Queryable,
  userId: string,
  id: string,
  assistantVisible = false,
) {
  const row = (
    await db.query(
      `SELECT p.id FROM projects p WHERE p.id = $2 AND ${visibleProjects("p", {
        user: "$1",
        ...(assistantVisible ? { ai: true } : {}),
      })}`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, "Project not found.");
}

async function ownedPlan(
  db: Queryable,
  userId: string,
  id: string | null,
  assistantVisible = false,
) {
  if (!id) return;
  const row = (
    await db.query(
      `SELECT id FROM docs WHERE id = $2 AND user_id = $1 AND team_id IS NULL
        AND kind = 'agent' AND deleted_at IS NULL
        AND (${assistantVisible ? visibleDocs("docs", { user: "$1", ai: true }) : "true"})`,
      [userId, id],
    )
  ).rows[0];
  if (!row) fail(404, "The goal's Agent plan note was not found.");
}

/** Monday for the current week in the person's planner time zone. */
export async function goalWeekStart(
  db: Queryable,
  userId: string,
  now = new Date(),
) {
  const timezone =
    (
      await db.query<{ timezone: string }>(
        "SELECT timezone FROM planner_prefs WHERE user_id = $1",
        [userId],
      )
    ).rows[0]?.timezone ?? "UTC";
  const today = localDateKey(now, timezone);
  return addDays(today, -((weekdayOf(today) + 6) % 7));
}

export async function listGoals(
  db: Queryable,
  userId: string,
  assistantVisible = false,
): Promise<Goal[]> {
  const rows = (
    await db.query<GoalRow>(
      `SELECT ${GOAL_SELECT} FROM goals g
         LEFT JOIN docs d ON d.id = g.plan_doc_id AND d.deleted_at IS NULL
         LEFT JOIN projects p ON p.id = g.project_id
        WHERE g.user_id = $1
          AND ($2::boolean = false OR ${ASSISTANT_VISIBLE_GOAL})
        ORDER BY
          CASE g.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
          g.updated_at DESC, g.id`,
      [userId, assistantVisible],
    )
  ).rows;
  return rows.map(goalOf);
}

export async function readGoal(
  db: Queryable,
  userId: string,
  id: string,
  assistantVisible = false,
): Promise<Goal | null> {
  const row = (
    await db.query<GoalRow>(
      `SELECT ${GOAL_SELECT} FROM goals g
         LEFT JOIN docs d ON d.id = g.plan_doc_id AND d.deleted_at IS NULL
         LEFT JOIN projects p ON p.id = g.project_id
        WHERE g.user_id = $1 AND g.id = $2
          AND ($3::boolean = false OR ${ASSISTANT_VISIBLE_GOAL})`,
      [userId, id, assistantVisible],
    )
  ).rows[0];
  return row ? goalOf(row) : null;
}

export async function saveGoal(
  db: Queryable,
  userId: string,
  id: string | null,
  raw: unknown,
  assistantVisible = false,
): Promise<Goal> {
  const current = id
    ? (
        await db.query<GoalRow>(
          `SELECT ${GOAL_SELECT} FROM goals g
             LEFT JOIN docs d ON d.id = g.plan_doc_id AND d.deleted_at IS NULL
             LEFT JOIN projects p ON p.id = g.project_id
            WHERE g.user_id = $1 AND g.id = $2
              AND ($3::boolean = false OR ${ASSISTANT_VISIBLE_GOAL})
            FOR UPDATE OF g`,
          [userId, id, assistantVisible],
        )
      ).rows[0]
    : undefined;
  if (id && !current) fail(404, "Goal not found.");
  const parsed = id
    ? goalInput.parse({
        title: current!.title,
        target: current!.target,
        target_date: current!.target_date,
        plan_doc_id: current!.plan_doc_id,
        project_id: current!.project_id,
        status: current!.status,
        ...goalUpdate.parse(raw),
      })
    : goalInput.parse(raw);
  if (parsed.project_id)
    await visibleProject(db, userId, parsed.project_id, assistantVisible);
  await ownedPlan(db, userId, parsed.plan_doc_id, assistantVisible);
  if (parsed.project_id && parsed.plan_doc_id) {
    const linked = (
      await db.query(
        `SELECT 1 FROM docs WHERE id = $1 AND project_id IS NOT DISTINCT FROM $2::uuid`,
        [parsed.plan_doc_id, parsed.project_id],
      )
    ).rowCount;
    if (!linked) fail(422, "The goal's Agent note must belong to its project.");
  }
  const savedId = id
    ? (
        await db.query(
          `UPDATE goals SET title = $3, target = $4, target_date = $5,
             plan_doc_id = $6, project_id = $7, status = $8, updated_at = now()
           WHERE id = $1 AND user_id = $2 RETURNING id`,
          [
            id,
            userId,
            parsed.title,
            parsed.target,
            parsed.target_date,
            parsed.plan_doc_id,
            parsed.project_id,
            parsed.status,
          ],
        )
      ).rows[0]?.id
    : (
        await db.query(
          `INSERT INTO goals (user_id, title, target, target_date, plan_doc_id, project_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            userId,
            parsed.title,
            parsed.target,
            parsed.target_date,
            parsed.plan_doc_id,
            parsed.project_id,
            parsed.status,
          ],
        )
      ).rows[0]?.id;
  if (!savedId) fail(404, "Goal not found.");
  const saved = await readGoal(db, userId, savedId, assistantVisible);
  if (!saved) fail(404, "Goal not found.");
  return saved;
}

export async function deleteGoal(
  db: Queryable,
  userId: string,
  id: string,
  assistantVisible = false,
) {
  const result = await db.query(
    `DELETE FROM goals g WHERE g.id = $2 AND g.user_id = $1
       AND ($3::boolean = false OR ${ASSISTANT_VISIBLE_GOAL})`,
    [userId, id, assistantVisible],
  );
  if (!result.rowCount) fail(404, "Goal not found.");
}

export async function listGoalCheckins(
  db: Queryable,
  userId: string,
  goalId: string,
  assistantVisible = false,
): Promise<GoalCheckin[]> {
  const rows = (
    await db.query<{
      id: string;
      goal_id: string;
      week_of: string;
      summary: string;
      progress: Record<string, unknown>;
      status: GoalCheckin["status"];
      created_at: Date;
    }>(
      `SELECT c.id, c.goal_id, c.week_of::text, c.summary, c.progress, c.status, c.created_at
         FROM goals_checkins c JOIN goals g ON g.id = c.goal_id
         WHERE c.user_id = $1 AND g.user_id = $1 AND c.user_id = g.user_id
           AND c.goal_id = $2
           AND ($3::boolean = false OR ${ASSISTANT_VISIBLE_GOAL})
        ORDER BY c.week_of DESC LIMIT 52`,
      [userId, goalId, assistantVisible],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    created_at: row.created_at.toISOString(),
  }));
}

export async function saveGoalCheckin(
  db: Queryable,
  input: {
    userId: string;
    goalId: string;
    weekOf: string;
    summary: string;
    progress: Record<string, unknown>;
    assistantVisible?: boolean;
  },
) {
  const row = (
    await db.query(
      `INSERT INTO goals_checkins (goal_id, user_id, week_of, summary, progress, status)
       SELECT g.id, g.user_id, $3::date, $4, $5::jsonb, 'done'
         FROM goals g WHERE g.id = $1 AND g.user_id = $2
           AND ($6::boolean = false OR ${ASSISTANT_VISIBLE_GOAL})
       ON CONFLICT (goal_id, week_of) DO UPDATE
         SET summary = EXCLUDED.summary, progress = EXCLUDED.progress, status = 'done'
       RETURNING id`,
      [
        input.goalId,
        input.userId,
        input.weekOf,
        input.summary,
        JSON.stringify(input.progress),
        input.assistantVisible ?? false,
      ],
    )
  ).rows[0];
  if (!row) fail(404, "Goal not found.");
}

export async function assistantGoalRoutes(app: FastifyInstance) {
  app.get("/me/goals", async (r) => {
    const user = await authenticate(r);
    return listGoals(pool, user.id);
  });
  app.post("/me/goals", async (r, reply) => {
    const user = await authenticate(r);
    const goal = await transaction((db) => saveGoal(db, user.id, null, r.body));
    reply.code(201);
    return goal;
  });
  app.put("/me/goals/:id", async (r) => {
    const user = await authenticate(r);
    return transaction((db) => saveGoal(db, user.id, idParam(r), r.body));
  });
  app.delete("/me/goals/:id", async (r) => {
    const user = await authenticate(r);
    await transaction((db) => deleteGoal(db, user.id, idParam(r)));
    return { deleted: true };
  });
  app.get("/me/goals/:id/checkins", async (r) => {
    const user = await authenticate(r);
    if (!(await readGoal(pool, user.id, idParam(r))))
      fail(404, "Goal not found.");
    return listGoalCheckins(pool, user.id, idParam(r));
  });
}
