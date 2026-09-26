import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  itemMilestoneInput,
  milestoneInput,
  milestoneStatus,
  milestoneUpdate,
  remainingOf,
  type ProjectMilestone,
} from "@orbyn/core";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { visibleItems } from "../../lib/visibility.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { loadPrefs } from "../planner/calendar.js";
import {
  FIT_COLUMNS,
  fitsFor,
  sessionsFor,
  type FitRow,
} from "../planner/planned.js";
import { loadItem, lockItem, requireItemAccess } from "../items/service.js";
import { requireProject } from "./service.js";

/**
 * Milestones: a project's own dated list of checkpoints. Each one rolls up
 * its tasks: how many there are and are done (everyone's), and, for the
 * viewer's part only, the time still needed, the time planned before each
 * task's deadline and when the last of it is planned to finish. Teammates'
 * sessions stay private, as on the project's planning strip.
 */

type MilestoneRow = {
  id: string;
  project_id: string;
  name: string;
  due_on: string;
  done_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `m.id, m.project_id, m.name, to_char(m.due_on, 'YYYY-MM-DD') AS due_on,
  m.done_at, m.created_at, m.updated_at`;

const VISIBLE_PROJECT = `((p.team_id IS NULL AND p.user_id = $1)
  OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

/** Every milestone of a project, soonest first, rolled up for `userId`. */
export async function projectMilestones(
  db: Queryable,
  userId: string,
  projectId: string,
  now = new Date(),
): Promise<ProjectMilestone[]> {
  const milestones = (
    await db.query<MilestoneRow>(
      `SELECT ${COLUMNS} FROM project_milestones m
        WHERE m.project_id = $1 ORDER BY m.due_on, m.created_at, m.id`,
      [projectId],
    )
  ).rows;
  if (!milestones.length) return [];
  const counts = new Map(
    (
      await db.query<{ milestone_id: string; total: number; done: number }>(
        `SELECT i.milestone_id, count(*)::int AS total,
                count(*) FILTER (WHERE i.status = 'done')::int AS done
           FROM items i
          WHERE i.project_id = $2 AND i.milestone_id IS NOT NULL
            AND i.status <> 'cancelled' AND ${visibleItems()}
          GROUP BY i.milestone_id`,
        [userId, projectId],
      )
    ).rows.map((r) => [r.milestone_id, r]),
  );
  // Your part: your own tasks, and team tasks assigned to you.
  const rows = (
    await db.query<FitRow & { milestone_id: string }>(
      `SELECT ${FIT_COLUMNS}, i.milestone_id FROM items i
        WHERE i.project_id = $2 AND i.milestone_id IS NOT NULL
          AND i.kind = 'task' AND i.status NOT IN ('done', 'cancelled')
          AND ${visibleItems()}
          AND (CASE WHEN i.team_id IS NULL THEN i.user_id = $1
                    ELSE i.assignee_id = $1 END)
        ORDER BY i.created_at, i.id LIMIT 500`,
      [userId, projectId],
    )
  ).rows;
  const sessions = await sessionsFor(
    db,
    userId,
    rows.map((r) => r.id),
    now,
  );
  const fits = await fitsFor(db, userId, rows, sessions, now);
  const { timezone } = await loadPrefs(db as Db, userId);
  return milestones.map((m) => {
    const mine = rows.filter(
      (r) => r.milestone_id === m.id && r.open_children === 0,
    );
    let needed = 0;
    let planned = 0;
    let last: number | null = null;
    let unestimated = 0;
    for (const r of mine) {
      const fit = fits.get(r.id);
      if (r.estimate_minutes == null) {
        unestimated++;
        continue;
      }
      const need = fit?.fit?.needed_minutes ?? remainingOf(r);
      needed += need;
      planned += Math.min(need, fit?.planned_minutes ?? 0);
      const deadline = fit?.fit?.deadline_at
        ? Date.parse(fit.fit.deadline_at)
        : null;
      for (const s of sessions.get(r.id) ?? []) {
        const end = Date.parse(s.end_at);
        if (end <= now.getTime()) continue;
        if (deadline && deadline > now.getTime() && end > deadline) continue;
        if (last === null || end > last) last = end;
      }
    }
    const c = counts.get(m.id);
    const rolled = {
      id: m.id,
      project_id: m.project_id,
      name: m.name,
      due_on: m.due_on,
      done_at: m.done_at?.toISOString() ?? null,
      created_at: m.created_at.toISOString(),
      updated_at: m.updated_at.toISOString(),
      task_count: c?.total ?? 0,
      done_count: c?.done ?? 0,
      needed_minutes: needed,
      planned_minutes: planned,
      planned_finish_at:
        needed > 0 && planned >= needed && unestimated === 0 && last !== null
          ? new Date(last).toISOString()
          : null,
      unestimated_count: unestimated,
    };
    return { ...rolled, status: milestoneStatus(rolled, now, timezone) };
  });
}

/** A change to a project's milestones, in its History (seen by everyone in it). */
async function logMilestone(
  db: Db,
  u: UserRow,
  projectId: string,
  kind: "milestone_added" | "milestone_changed" | "milestone_removed",
  id: string,
  summary: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  await db.query(
    `INSERT INTO project_activity (project_id, actor_id, kind, entity_type,
       entity_id, summary, before_state, after_state)
     VALUES ($1, $2, $3, 'milestone', $4, left($5, 240), $6::jsonb, $7::jsonb)`,
    [
      projectId,
      u.id,
      kind,
      id,
      summary,
      before && JSON.stringify(before),
      after && JSON.stringify(after),
    ],
  );
}

/** Put project tasks into a milestone (or take them out, with null). */
async function placeTasks(
  db: Db,
  u: UserRow,
  projectId: string,
  teamId: string | null,
  itemIds: string[],
  milestoneId: string | null,
) {
  if (!itemIds.length) return;
  const moved = (
    await db.query<{ id: string }>(
      `UPDATE items i SET milestone_id = $3, version = version + 1, updated_at = now()
        WHERE i.id = ANY($2::uuid[]) AND i.project_id = $4 AND i.kind = 'task'
          AND ${visibleItems()}
        RETURNING i.id`,
      [u.id, [...new Set(itemIds)], milestoneId, projectId],
    )
  ).rows;
  if (moved.length !== new Set(itemIds).size)
    fail(422, "Only this project's tasks can be in its milestones.");
  for (const row of moved)
    await queueWebhooks(
      db,
      "item.updated",
      { user_id: u.id, team_id: teamId },
      await loadItem(db, row.id),
    );
}

async function ownMilestone(db: Db, projectId: string, id: string) {
  const row = (
    await db.query<MilestoneRow>(
      `SELECT ${COLUMNS} FROM project_milestones m
        WHERE m.id = $1 AND m.project_id = $2 FOR UPDATE`,
      [id, projectId],
    )
  ).rows[0];
  if (!row) fail(404, "Milestone not found");
  return row;
}

const params = z.object({ id: z.uuid(), milestoneId: z.uuid() });

export async function milestoneRoutes(app: FastifyInstance) {
  app.get("/projects/:id/milestones", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const visible = await db.query(
      `SELECT 1 FROM projects p WHERE p.id = $2 AND ${VISIBLE_PROJECT}`,
      [u.id, id],
    );
    if (!visible.rowCount) fail(404, "Project not found");
    return projectMilestones(db, u.id, id);
  });

  app.post("/projects/:id/milestones", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = milestoneInput.parse(r.body);
    const made = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const project = await requireProject(db, id, u, "items:write");
      // One add at a time per project, so parallel adds can't pass the cap.
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtext('project_milestones:' || $1))",
        [id],
      );
      const count = (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM project_milestones WHERE project_id = $1",
          [id],
        )
      ).rows[0].n;
      if (count >= 50) fail(409, "A project can have up to 50 milestones.");
      const row = (
        await db.query<{ id: string }>(
          `INSERT INTO project_milestones (project_id, name, due_on, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [id, d.name, d.due_on, u.id],
        )
      ).rows[0];
      await placeTasks(db, u, id, project.team_id, d.item_ids ?? [], row.id);
      await logMilestone(
        db,
        u,
        id,
        "milestone_added",
        row.id,
        `Milestone added: ${d.name}`,
        null,
        { name: d.name, due_on: d.due_on },
      );
      return row.id;
    });
    reply.code(201);
    const all = await projectMilestones(reader(r.headers), u.id, id);
    return all.find((m) => m.id === made)!;
  });

  app.put("/projects/:id/milestones/:milestoneId", async (r) => {
    const u = await authenticate(r);
    const p = params.parse(r.params);
    const d = milestoneUpdate.parse(r.body);
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireProject(db, p.id, u, "items:write");
      const before = await ownMilestone(db, p.id, p.milestoneId);
      const after = (
        await db.query<MilestoneRow>(
          `UPDATE project_milestones m SET
             name = coalesce($3, name),
             due_on = coalesce($4::date, due_on),
             done_at = CASE WHEN $5::boolean IS NULL THEN done_at
                            WHEN $5 THEN coalesce(done_at, now()) ELSE NULL END,
             updated_at = now()
           WHERE m.id = $1 AND m.project_id = $2 RETURNING ${COLUMNS}`,
          [
            p.milestoneId,
            p.id,
            d.name ?? null,
            d.due_on ?? null,
            d.done ?? null,
          ],
        )
      ).rows[0];
      const was = {
        name: before.name,
        due_on: before.due_on,
        done: !!before.done_at,
      };
      const now = {
        name: after.name,
        due_on: after.due_on,
        done: !!after.done_at,
      };
      if (JSON.stringify(was) !== JSON.stringify(now))
        await logMilestone(
          db,
          u,
          p.id,
          "milestone_changed",
          p.milestoneId,
          !was.done && now.done
            ? `Milestone done: ${after.name}`
            : `Milestone changed: ${after.name}`,
          was,
          now,
        );
    });
    const all = await projectMilestones(reader(r.headers), u.id, p.id);
    return all.find((m) => m.id === p.milestoneId)!;
  });

  app.delete("/projects/:id/milestones/:milestoneId", async (r, reply) => {
    const u = await authenticate(r);
    const p = params.parse(r.params);
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireProject(db, p.id, u, "items:write");
      const before = await ownMilestone(db, p.id, p.milestoneId);
      // Its tasks stay in the project; other devices hear they changed.
      await db.query(
        `UPDATE items SET milestone_id = NULL, version = version + 1, updated_at = now()
          WHERE milestone_id = $1`,
        [p.milestoneId],
      );
      await db.query("DELETE FROM project_milestones WHERE id = $1", [
        p.milestoneId,
      ]);
      await logMilestone(
        db,
        u,
        p.id,
        "milestone_removed",
        p.milestoneId,
        `Milestone removed: ${before.name}`,
        { name: before.name, due_on: before.due_on },
        null,
      );
    });
    reply.code(204);
  });

  /** Put one task in a milestone of its project, or take it out. */
  app.put("/items/:id/milestone", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { milestone_id } = itemMilestoneInput.parse(r.body);
    return transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      if (milestone_id && item.kind !== "task")
        fail(422, "Only tasks can be part of a milestone.");
      if (milestone_id) {
        const ok = await db.query(
          "SELECT 1 FROM project_milestones WHERE id = $1 AND project_id = $2",
          [milestone_id, item.project_id],
        );
        if (!ok.rowCount)
          fail(422, "Choose a milestone of this task's project.");
      }
      await db.query(
        `UPDATE items SET milestone_id = $2, version = version + 1, updated_at = now()
          WHERE id = $1`,
        [id, milestone_id],
      );
      const updated = await loadItem(db, id);
      await queueWebhooks(
        db,
        "item.updated",
        { user_id: u.id, team_id: item.team_id ?? null },
        updated,
      );
      return updated;
    });
  });
}
