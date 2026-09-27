import type { FastifyInstance } from "fastify";
import {
  fail,
  projectAssign,
  projectInput,
  projectLinkInput,
  planDaysBefore,
  planPreviewInput,
  projectUpdate,
  type Project,
  type ProjectLink,
  type ProjectSession,
} from "@orbyn/core";
import { reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { projectTimeMachineRoutes } from "./time-machine.js";
import { milestoneRoutes } from "./milestones.js";
import { setAssistantOff } from "./assistant.js";
import { loadItem } from "../items/service.js";
import { projectPlanning } from "./planning.js";
import { visibleProjectActivity } from "./activity-visibility.js";
import { makeProjectPlan } from "../planner/plans.js";
import { queueWebhooks } from "../../lib/webhooks.js";
import { z } from "zod";
import { actAs } from "../../lib/actor.js";

import {
  VISIBLE,
  findProject,
  listProjects,
  loadProject,
  projectVisible,
  requireProject,
  stagesFor,
  announceProjects,
  createProject,
  deleteProject,
  updateProject,
  addProjectLink,
  removeProjectLink,
} from "./service.js";
/**
 * Projects group planner tasks into a named piece of work with ordered
 * stages. Personal projects belong to their creator; team projects follow the
 * same team roles as team items. Tasks are not copied — a project only sets
 * `project_id` and `stage_id` on the items that belong to it, so scheduling,
 * reminders and the calendar keep working untouched.
 */

export async function projectRoutes(app: FastifyInstance) {
  await projectTimeMachineRoutes(app);
  await milestoneRoutes(app);
  app.get("/projects", async (r) => {
    const u = await authenticate(r);
    const db = reader(r.headers);
    const rows = await listProjects(db, u.id);
    const stages = await stagesFor(
      db,
      rows.map((p) => p.id),
    );
    return rows.map((p) => ({ ...p, stages: stages.get(p.id) ?? [] }));
  });

  app.post("/projects", async (r, reply) => {
    const u = await authenticate(r);
    const data = projectInput.parse(r.body);
    const project = await transaction((db) => createProject(db, u, data));
    reply.code(201);
    return project;
  });

  app.get("/projects/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const row = await findProject(db, u.id, id);
    if (!row) fail(404, "Project not found");
    const stages = await stagesFor(db, [id]);
    return { ...row, stages: stages.get(id) ?? [] };
  });

  /**
   * Keep the project out of the assistant, or let it back in. Only the
   * owner of a personal project, or a team's owners and admins, decide.
   */
  app.put("/projects/:id/assistant", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const { off } = z.object({ off: z.boolean() }).strict().parse(r.body);
    return transaction(async (db) => {
      await setAssistantOff(db, u, id, off);
      return loadProject(db, id);
    });
  });

  app.get("/projects/:id/links", async (r): Promise<ProjectLink[]> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    if (!(await projectVisible(db, u.id, id))) fail(404, "Project not found");
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
    const link = await transaction((db) => addProjectLink(db, u, id, input));
    reply.code(201);
    return link;
  });

  app.delete("/projects/:id/links/:linkId", async (r, reply) => {
    const u = await authenticate(r);
    const params = z.object({ id: z.uuid(), linkId: z.uuid() }).parse(r.params);
    await transaction((db) =>
      removeProjectLink(db, u, params.id, params.linkId),
    );
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
    if (!(await projectVisible(db, u.id, id))) fail(404, "Project not found");
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
      await actAs(db, u.id);
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
      if (!(await projectVisible(db, u.id, id))) fail(404, "Project not found");
      return (
        await db.query(
          `SELECT a.id, a.project_id, a.actor_id, u.name AS actor_name,
                  a.kind, a.entity_type, a.entity_id, a.event_order, a.summary,
                  a.before_state,
                  (a.after_state - 'baseline_tasks' - 'baseline_notes'
                    - 'baseline_records' - 'baseline_stages') AS after_state,
                  a.origin,
                  CASE WHEN g.id IS NOT NULL THEN coalesce(nullif(g.client_name, ''),
                    nullif(g.name, ''), 'an agent')
                    WHEN a.origin = 'assistant' THEN coalesce(nullif(agent.name, ''), 'Orbyn')
                  END AS via_agent,
                  a.created_at
             FROM project_activity a LEFT JOIN users u ON u.id = a.actor_id
             LEFT JOIN agent_grants g ON g.id = a.via_grant_id
             LEFT JOIN agent_settings agent ON agent.user_id = a.actor_id
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
    return transaction((db) => updateProject(db, u, id, body));
  });

  app.delete("/projects/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    // The tasks outlive the project; they simply become unfiled.
    await transaction((db) => deleteProject(db, u, id));
    reply.code(204);
  });

  /** Put a task in a project and stage, or take it out of both. */
  app.put("/items/:id/project", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = projectAssign.parse(r.body);
    return transaction(async (db) => {
      await actAs(db, u.id);
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
