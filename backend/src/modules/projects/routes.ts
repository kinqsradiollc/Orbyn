import type { FastifyInstance } from "fastify";
import {
  DEFAULT_STAGES,
  fail,
  projectAssign,
  projectInput,
  projectLinkInput,
  planDaysBefore,
  planPreviewInput,
  projectUpdate,
  type Project,
  type ProjectLink,
  type ProjectStage,
  type ProjectSession,
} from "@orbyn/core";
import { reader, transaction, type Db, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { PROJECT_COUNTS } from "./counts.js";
import { projectTimeMachineRoutes } from "./time-machine.js";
import { loadItem } from "../items/service.js";
import { projectPlanning } from "./planning.js";
import { visibleProjectActivity } from "./activity-visibility.js";
import { makeProjectPlan } from "../planner/plans.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { z } from "zod";

/**
 * Projects group planner tasks into a named piece of work with ordered
 * stages. Personal projects belong to their creator; team projects follow the
 * same team roles as team items. Tasks are not copied — a project only sets
 * `project_id` and `stage_id` on the items that belong to it, so scheduling,
 * reminders and the calendar keep working untouched.
 */

const COLUMNS = `p.id, p.user_id, p.team_id, t.name AS team_name, p.name, p.summary,
  p.status, p.deadline, p.doc_id, p.created_at, p.updated_at,
  ${PROJECT_COUNTS}`;

/** Projects `$1` can see: their own, and their teams'. */
const VISIBLE = `((p.team_id IS NULL AND p.user_id = $1)
  OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`;

type Owned = { id: string; user_id: string; team_id: string | null };

async function requireProject(
  db: Db,
  id: string,
  u: UserRow,
  permission: "items:read" | "items:write",
): Promise<Owned> {
  const row = (
    await db.query<Owned>(
      "SELECT id, user_id, team_id FROM projects WHERE id = $1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) fail(404, "Project not found");
  if (row.team_id) await requireTeam(row.team_id, u, permission, db);
  else if (row.user_id !== u.id) fail(404, "Project not found");
  return row;
}

/** Stages for a set of projects, in order, keyed by project. */
async function stagesFor(db: Queryable, ids: string[]) {
  if (!ids.length) return new Map<string, ProjectStage[]>();
  const rows = (
    await db.query<ProjectStage>(
      `SELECT id, project_id, name, position FROM project_stages
        WHERE project_id = ANY($1::uuid[]) ORDER BY position, name`,
      [ids],
    )
  ).rows;
  const map = new Map<string, ProjectStage[]>();
  for (const s of rows)
    map.set(s.project_id, [...(map.get(s.project_id) ?? []), s]);
  return map;
}

/** Read one project back with its stages attached. */
async function loadProject(db: Queryable, id: string): Promise<Project> {
  const row = (
    await db.query<Project>(
      `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
        WHERE p.id = $1`,
      [id],
    )
  ).rows[0];
  const stages = await stagesFor(db, [id]);
  return { ...row, stages: stages.get(id) ?? [] };
}

export async function projectRoutes(app: FastifyInstance) {
  await projectTimeMachineRoutes(app);
  app.get("/projects", async (r) => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const rows = (
      await db.query<Project>(
        `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
          WHERE ${VISIBLE} ORDER BY p.status = 'archived', p.updated_at DESC
          LIMIT 200`,
        [u.id],
      )
    ).rows;
    const stages = await stagesFor(
      db,
      rows.map((p) => p.id),
    );
    return rows.map((p) => ({ ...p, stages: stages.get(p.id) ?? [] }));
  });

  app.post("/projects", async (r, reply) => {
    const u = await authenticate(r);
    const data = projectInput.parse(r.body);
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    const project = await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO projects (user_id, team_id, name, summary, deadline)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [u.id, data.team_id, data.name, data.summary, data.deadline],
        )
      ).rows[0].id;
      const names = data.stages?.length ? data.stages : DEFAULT_STAGES;
      for (const [position, name] of names.entries())
        await db.query(
          "INSERT INTO project_stages (project_id, name, position) VALUES ($1,$2,$3)",
          [id, name, position],
        );
      return loadProject(db, id);
    });
    reply.code(201);
    return project;
  });

  app.get("/projects/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const row = (
      await db.query<Project>(
        `SELECT ${COLUMNS} FROM projects p LEFT JOIN teams t ON t.id = p.team_id
          WHERE p.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!row) fail(404, "Project not found");
    const stages = await stagesFor(db, [id]);
    return { ...row, stages: stages.get(id) ?? [] };
  });

  app.get("/projects/:id/links", async (r): Promise<ProjectLink[]> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const visible = await db.query(
      `SELECT 1 FROM projects p WHERE p.id = $2 AND ${VISIBLE}`,
      [u.id, id],
    );
    if (!visible.rows.length) fail(404, "Project not found");
    return (
      await db.query<ProjectLink>(
        `SELECT id, project_id, url, title, created_at FROM project_links
         WHERE project_id = $1 ORDER BY created_at, id`,
        [id],
      )
    ).rows;
  });

  app.post("/projects/:id/links", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const input = projectLinkInput.parse(r.body);
    const link = await transaction(async (db) => {
      // requireProject locks the project row (FOR UPDATE), so two adds at
      // once are counted one after the other and never pass 20 together.
      await requireProject(db, id, u, "items:write");
      const existing = await db.query(
        "SELECT 1 FROM project_links WHERE project_id = $1 AND url = $2",
        [id, input.url],
      );
      const count = await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM project_links WHERE project_id = $1",
        [id],
      );
      if (!existing.rows.length && Number(count.rows[0].count) >= 20)
        fail(409, "Project links are full");
      return (
        await db.query<ProjectLink>(
          `INSERT INTO project_links (project_id, url, title) VALUES ($1, $2, $3)
           ON CONFLICT (project_id, url) DO UPDATE SET title = EXCLUDED.title
           RETURNING id, project_id, url, title, created_at`,
          [id, input.url, input.title],
        )
      ).rows[0];
    });
    reply.code(201);
    return link;
  });

  app.delete("/projects/:id/links/:linkId", async (r, reply) => {
    const u = await authenticate(r);
    const params = z.object({ id: z.uuid(), linkId: z.uuid() }).parse(r.params);
    await transaction(async (db) => {
      await requireProject(db, params.id, u, "items:write");
      const removed = await db.query(
        "DELETE FROM project_links WHERE id = $1 AND project_id = $2 RETURNING id",
        [params.linkId, params.id],
      );
      if (!removed.rows.length) fail(404, "Link not found");
    });
    reply.code(204);
  });

  app.post("/projects/:id/visit", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    return transaction(async (db) => {
      await requireProject(db, id, u, "items:read");
      const visit = (
        await db.query<{ previous_seen_at: Date | null; last_seen_at: Date }>(
          `INSERT INTO project_visits(user_id, project_id, last_seen_at)
           VALUES($1, $2, now())
           ON CONFLICT (user_id, project_id) DO UPDATE SET
             previous_seen_at = CASE
               WHEN project_visits.last_seen_at < now() - interval '5 minutes'
                 THEN project_visits.last_seen_at
               ELSE project_visits.previous_seen_at END,
             last_seen_at = CASE
               WHEN project_visits.last_seen_at < now() - interval '5 minutes'
                 THEN now()
               ELSE project_visits.last_seen_at END
           RETURNING previous_seen_at, last_seen_at`,
          [u.id, id],
        )
      ).rows[0];
      return {
        since_at: visit.previous_seen_at?.toISOString() ?? null,
        visited_at: visit.last_seen_at.toISOString(),
      };
    });
  });

  app.get("/projects/:id/planning", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const project = (
      await db.query<{
        id: string;
        deadline: Date | null;
        team_id: string | null;
      }>(
        `SELECT p.id, p.deadline, p.team_id FROM projects p
          WHERE p.id = $2 AND ${VISIBLE}`,
        [u.id, id],
      )
    ).rows[0];
    if (!project) fail(404, "Project not found");
    // Team totals follow the capacity view's show-hours rule (teams/capacity.ts):
    // only the team's effective owners and admins see hours across people.
    const showHours = project.team_id
      ? ["owner", "admin"].includes(
          (await requireTeam(project.team_id, u, "items:read")).effective,
        )
      : false;
    return projectPlanning(db, u.id, project, showHours);
  });

  /** Actual sessions on this project's timeline, belonging only to the viewer. */
  app.get("/projects/:id/sessions", async (r): Promise<ProjectSession[]> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const visible = await db.query(
      `SELECT 1 FROM projects p WHERE p.id = $2 AND ${VISIBLE}`,
      [u.id, id],
    );
    if (!visible.rowCount) fail(404, "Project not found");
    const rows = (
      await db.query<{
        id: string;
        item_id: string;
        start_at: Date;
        end_at: Date;
      }>(
        `SELECT b.id, b.item_id, b.start_at, b.end_at
         FROM time_blocks b JOIN items i ON i.id = b.item_id
         WHERE i.project_id = $1 AND b.user_id = $2
         ORDER BY b.start_at DESC LIMIT 500`,
        [id, u.id],
      )
    ).rows;
    return rows.map((row) => ({
      ...row,
      start_at: row.start_at.toISOString(),
      end_at: row.end_at.toISOString(),
    }));
  });

  /** Preview only work this person owns in this project, plus the unassigned
   * team tasks they claim with this call (claiming makes them the assignee;
   * only the assignee is written, so other edits to those tasks are kept).
   * Planning puts sessions on your calendar, so it needs edit rights. */
  app.post("/projects/:id/plan", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { timezone, claim_item_ids: claim } = z
      .object({
        timezone: z.string().max(100).optional(),
        claim_item_ids: z.array(z.string().uuid()).max(50).optional(),
      })
      .strict()
      .parse(r.body ?? {});
    return transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const project = await requireProject(db, id, u, "items:write");
      const details = (
        await db.query<{ status: string; deadline: Date | null }>(
          "SELECT status, deadline FROM projects WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (details.status !== "active")
        fail(422, "Only active projects can be planned.");
      if (claim?.length) {
        if (!project.team_id) fail(422, "Only team tasks can be claimed.");
        const claimed = (
          await db.query<{ id: string }>(
            `UPDATE items SET assignee_id = $2, version = version + 1, updated_at = now()
              WHERE id = ANY($1::uuid[]) AND project_id = $3 AND team_id = $4
                AND kind = 'task' AND assignee_id IS NULL
                AND status NOT IN ('done', 'cancelled')
              RETURNING id`,
            [[...new Set(claim)], u.id, id, project.team_id],
          )
        ).rows;
        if (claimed.length !== new Set(claim).size)
          fail(
            409,
            "Someone else took one of those tasks, or it's finished. Refresh and try again.",
          );
        for (const row of claimed)
          await queueWebhooks(
            db,
            "item.updated",
            { user_id: u.id, team_id: project.team_id },
            await loadItem(db, row.id),
          );
      }
      const tasks = (
        await db.query<{ id: string }>(
          `SELECT id FROM items WHERE project_id = $1 AND kind = 'task'
           AND status NOT IN ('done', 'cancelled')
           AND (CASE WHEN team_id IS NULL THEN user_id = $2
                     ELSE team_id = $3 AND assignee_id = $2 END)
           ORDER BY created_at LIMIT 201`,
          [id, u.id, project.team_id],
        )
      ).rows;
      if (!tasks.length)
        fail(
          422,
          "No tasks assigned to you in this project. Claim an unassigned task to plan it.",
        );
      if (tasks.length > 200)
        fail(422, "A project plan can include up to 200 assigned tasks.");
      return makeProjectPlan(
        db,
        u.id,
        id,
        planPreviewInput.parse({
          item_ids: tasks.map((task) => task.id),
          days:
            planDaysBefore(
              details.deadline?.toISOString(),
              new Date(),
              timezone,
            ) ?? 14,
          timezone,
        }),
      );
    });
  });

  /** A readable project timeline; its payload intentionally excludes note bodies. */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/projects/:id/activity",
    async (r) => {
      const u = await authenticate(r);
      const id = idParam(r);
      const requested = Number(r.query.limit ?? 100);
      if (!Number.isInteger(requested) || requested < 1 || requested > 200)
        fail(422, "Limit must be between 1 and 200.");
      const db = reader(r.headers);
      const visible = (
        await db.query<{ id: string }>(
          `SELECT p.id FROM projects p WHERE p.id = $2 AND ${VISIBLE}`,
          [u.id, id],
        )
      ).rowCount;
      if (!visible) fail(404, "Project not found");
      return (
        await db.query(
          `SELECT a.id, a.project_id, a.actor_id, u.name AS actor_name,
                  a.kind, a.entity_type, a.entity_id, a.event_order, a.summary,
                  a.before_state,
                  (a.after_state - 'baseline_tasks' - 'baseline_notes'
                    - 'baseline_records' - 'baseline_stages') AS after_state,
                  a.created_at
             FROM project_activity a LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.project_id = $1 AND ${visibleProjectActivity("$3")}
            ORDER BY a.event_order DESC LIMIT $2`,
          [id, requested, u.id],
        )
      ).rows;
    },
  );

  app.put("/projects/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = projectUpdate.parse(r.body);
    return transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireProject(db, id, u, "items:write");
      const before = (
        await db.query<{ name: string; deadline: Date | null }>(
          "SELECT name, deadline FROM projects WHERE id = $1",
          [id],
        )
      ).rows[0];
      await db.query(
        `UPDATE projects SET
           name = coalesce($2, name),
           summary = coalesce($3, summary),
           status = coalesce($4, status),
           deadline = CASE WHEN $5::boolean THEN $6::timestamptz ELSE deadline END,
           doc_id = CASE WHEN $7::boolean THEN $8::uuid ELSE doc_id END,
           updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.name ?? null,
          body.summary ?? null,
          body.status ?? null,
          body.deadline !== undefined,
          body.deadline ?? null,
          body.doc_id !== undefined,
          body.doc_id ?? null,
        ],
      );
      // Pages are found by their project's name too: index them again.
      if (body.name !== undefined && body.name !== before.name)
        await db.query(
          "UPDATE docs SET project_id = project_id WHERE project_id = $1",
          [id],
        );
      // Tasks carry their project's deadline (their latest date): open apps
      // and offline copies pick up the change on their next sync.
      if (
        body.deadline !== undefined &&
        (body.deadline ? Date.parse(body.deadline) : null) !==
          (before.deadline?.getTime() ?? null)
      )
        await db.query(
          `UPDATE items SET updated_at = now()
            WHERE project_id = $1 AND status NOT IN ('done', 'cancelled')`,
          [id],
        );
      if (body.stages) {
        // Stages given without an id are new; ones left out are removed, and
        // the tasks that sat in them fall back to the project with no stage.
        const keep = body.stages.filter((s) => s.id).map((s) => s.id!);
        await db.query(
          `DELETE FROM project_stages
            WHERE project_id = $1 AND NOT (id = ANY($2::uuid[]))`,
          [id, keep],
        );
        for (const [position, stage] of body.stages.entries()) {
          if (stage.id)
            await db.query(
              "UPDATE project_stages SET name = $2, position = $3 WHERE id = $1 AND project_id = $4",
              [stage.id, stage.name, position, id],
            );
          else
            await db.query(
              "INSERT INTO project_stages (project_id, name, position) VALUES ($1,$2,$3)",
              [id, stage.name, position],
            );
        }
      }
      return loadProject(db, id);
    });
  });

  app.delete("/projects/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      await requireProject(db, id, u, "items:write");
      // The tasks outlive the project; they simply become unfiled.
      await db.query("DELETE FROM projects WHERE id = $1", [id]);
    });
    reply.code(204);
  });

  /** Put a task in a project and stage, or take it out of both. */
  app.put("/items/:id/project", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = projectAssign.parse(r.body);
    return transaction(async (db) => {
      await db.query("SELECT set_config('orbyn.user_id', $1, true)", [u.id]);
      const item = (
        await db.query<{
          id: string;
          user_id: string;
          team_id: string | null;
          kind: string;
          project_id: string | null;
          stage_id: string | null;
        }>(
          `SELECT id, user_id, team_id, kind, project_id, stage_id
             FROM items WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!item) fail(404, "Item not found");
      if (item.kind !== "task")
        fail(422, "Only tasks can be filed in projects.");
      if (item.team_id) await requireTeam(item.team_id, u, "items:write", db);
      else if (item.user_id !== u.id) fail(404, "Item not found");

      const stageId = body.project_id
        ? body.stage_id === undefined && item.project_id === body.project_id
          ? item.stage_id
          : (body.stage_id ?? null)
        : null;

      if (body.project_id) {
        const project = await requireProject(
          db,
          body.project_id,
          u,
          "items:write",
        );
        // A task goes into a project in its own space: a team's task into
        // that team's project, a personal task into a personal one.
        if (project.team_id !== item.team_id)
          fail(
            422,
            project.team_id
              ? "Only this team's tasks can go into a team project."
              : "Team tasks can only go into their team's projects.",
          );
        if (stageId) {
          const ok = (
            await db.query(
              "SELECT 1 FROM project_stages WHERE id = $1 AND project_id = $2",
              [stageId, body.project_id],
            )
          ).rowCount;
          if (!ok) fail(422, "That stage isn't in this project.");
        }
      }
      await db.query(
        `UPDATE items SET project_id = $2, stage_id = $3,
           version = version + 1, updated_at = now() WHERE id = $1`,
        [id, body.project_id, stageId],
      );
      return { ok: true, item: await loadItem(db, id) };
    });
  });
}
