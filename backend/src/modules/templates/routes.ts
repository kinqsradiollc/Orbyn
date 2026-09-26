import type { FastifyInstance } from "fastify";
import {
  dayTime,
  fail,
  localDateKey,
  TEMPLATE_STARTERS,
  templateInput,
  templateUpdate,
  templateUseInput,
  type DocBlock,
  type ProjectTemplate,
  type Proposal,
  type TemplateTask,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { loadPrefs } from "../planner/calendar.js";
import { findProject } from "../projects/service.js";
import {
  COLUMNS,
  type TemplateRow,
  VISIBLE,
  canManageTeam,
  draftOf,
  loadTemplate,
  nextRun,
  proposeFromTemplate,
  toTemplate,
} from "./service.js";

/**
 * Project templates: the starters everyone has, your own, and your teams'.
 * Owners and admins make a team's; everyone on the team uses them.
 */
export async function templateRoutes(app: FastifyInstance) {
  app.get("/templates", async (r): Promise<ProjectTemplate[]> => {
    const u = await authenticate(r);
    const rows = (
      await reader(r.headers).query<TemplateRow>(
        `SELECT ${COLUMNS} FROM project_templates t
           LEFT JOIN teams tm ON tm.id = t.team_id
          WHERE ${VISIBLE} ORDER BY t.team_id NULLS FIRST, t.name`,
        [u.id],
      )
    ).rows;
    const saved = await Promise.all(rows.map((row) => toTemplate(u, row)));
    const starters: ProjectTemplate[] = TEMPLATE_STARTERS.map((s) => ({
      ...s,
      source: "starter",
      team_id: null,
      team_name: null,
      next_at: null,
      can_edit: false,
      created_at: null,
    }));
    return [...saved, ...starters];
  });

  app.post("/templates", async (r, reply): Promise<ProjectTemplate> => {
    const u = await authenticate(r);
    const d = templateInput.parse(r.body);
    if (d.team_id && !(await canManageTeam(u, d.team_id)))
      fail(403, "Only a team's owners and admins can make its templates.");
    draftOf(d.name, d.tasks);
    const { timezone } = await loadPrefs(pool, u.id);
    const row = (
      await pool.query<{ id: string }>(
        `INSERT INTO project_templates
           (user_id, team_id, name, description, tasks, page, rrule, next_at, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          u.id,
          d.team_id,
          d.name,
          d.description,
          JSON.stringify(d.tasks),
          d.page ? JSON.stringify(d.page) : null,
          d.rrule,
          d.rrule ? nextRun(d.rrule, timezone, new Date()) : null,
          timezone,
        ],
      )
    ).rows[0];
    reply.code(201);
    return toTemplate(u, await loadTemplate(pool, u, row.id));
  });

  app.put("/templates/:id", async (r): Promise<ProjectTemplate> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = templateUpdate.parse(r.body);
    const current = await toTemplate(u, await loadTemplate(pool, u, id));
    if (!current.can_edit)
      fail(
        403,
        "Only its maker, or a team's owners and admins, can change it.",
      );
    const tasks = d.tasks ?? current.tasks;
    draftOf(d.name ?? current.name, tasks);
    const row = await loadTemplate(pool, u, id);
    const rrule = d.rrule === undefined ? current.rrule : d.rrule;
    await pool.query(
      `UPDATE project_templates SET name = $2, description = $3, tasks = $4,
         page = $5, rrule = $6, next_at = $7, updated_at = now()
       WHERE id = $1`,
      [
        id,
        d.name ?? current.name,
        d.description ?? current.description,
        JSON.stringify(tasks),
        (d.page === undefined ? current.page : d.page)
          ? JSON.stringify(d.page === undefined ? current.page : d.page)
          : null,
        rrule,
        rrule
          ? rrule === current.rrule && row.next_at
            ? row.next_at
            : nextRun(rrule, row.timezone, new Date())
          : null,
      ],
    );
    return toTemplate(u, await loadTemplate(pool, u, id));
  });

  app.delete("/templates/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const current = await toTemplate(u, await loadTemplate(pool, u, id));
    if (!current.can_edit)
      fail(
        403,
        "Only its maker, or a team's owners and admins, can delete it.",
      );
    await pool.query("DELETE FROM project_templates WHERE id = $1", [id]);
    reply.code(204);
  });

  /**
   * Save a project as a template: its open and done tasks, their estimates,
   * when each was due counted from the first, what waits on what, and its
   * brief. Names only; who did what stays with the project.
   */
  app.post(
    "/templates/from-project/:id",
    async (r, reply): Promise<ProjectTemplate> => {
      const u = await authenticate(r);
      const projectId = idParam(r);
      const project = await findProject<{
        id: string;
        name: string;
        team_id: string | null;
        user_id: string;
        doc_id: string | null;
        created_at: Date;
      }>(pool, u.id, projectId);
      if (!project) fail(404, "Project not found");
      if (project.team_id && !(await canManageTeam(u, project.team_id)))
        fail(403, "Only a team's owners and admins can make its templates.");
      const items = (
        await pool.query<{
          id: string;
          title: string;
          notes: string;
          estimate_minutes: number | null;
          due_at: Date | null;
          target_value: number | null;
          value_unit: string;
          created_at: Date;
        }>(
          `SELECT i.id, i.title, i.notes, i.estimate_minutes, i.due_at,
                  i.target_value, i.value_unit, i.created_at
             FROM items i
            WHERE i.project_id = $1 AND i.kind = 'task' AND i.status <> 'cancelled'
            ORDER BY i.due_at NULLS LAST, i.position, i.created_at
            LIMIT 15`,
          [project.id],
        )
      ).rows;
      if (!items.length)
        fail(422, "This project has no tasks to make a template from.");
      const { timezone } = await loadPrefs(pool, u.id);
      const first = localDateKey(
        items.find((i) => i.due_at)?.due_at ?? project.created_at,
        timezone,
      );
      const firstDay = dayTime(first, 0, timezone).getTime();
      const ref = new Map(items.map((i, n) => [i.id, `t${n + 1}`]));
      const deps = (
        await pool.query<{ item_id: string; prerequisite_id: string }>(
          "SELECT item_id, prerequisite_id FROM item_dependencies WHERE item_id = ANY($1::uuid[])",
          [items.map((i) => i.id)],
        )
      ).rows;
      const tasks: TemplateTask[] = items.map((i) => ({
        id: ref.get(i.id)!,
        title: i.title,
        notes: i.notes.slice(0, 10000),
        estimate_minutes: Math.max(5, i.estimate_minutes ?? 30),
        due_in_days: i.due_at
          ? Math.max(
              0,
              Math.min(
                365,
                Math.round(
                  (dayTime(
                    localDateKey(i.due_at, timezone),
                    0,
                    timezone,
                  ).getTime() -
                    firstDay) /
                    86_400_000,
                ),
              ),
            )
          : 0,
        depends_on: deps
          .filter((d) => d.item_id === i.id && ref.has(d.prerequisite_id))
          .map((d) => ref.get(d.prerequisite_id)!),
        target_value: i.target_value,
        value_unit: i.value_unit,
      }));
      const doc = project.doc_id
        ? (
            await pool.query<{ title: string; content: DocBlock[] }>(
              "SELECT title, content FROM docs WHERE id = $1 AND deleted_at IS NULL",
              [project.doc_id],
            )
          ).rows[0]
        : null;
      // Checked items become open ones again: a template starts fresh.
      const page = doc
        ? {
            title: doc.title,
            content: doc.content.map((b) =>
              b.type === "todo" ? { ...b, done: false } : b,
            ),
          }
        : null;
      draftOf(project.name, tasks);
      const row = (
        await pool.query<{ id: string }>(
          `INSERT INTO project_templates
             (user_id, team_id, name, description, tasks, page, timezone)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            u.id,
            project.team_id,
            project.name.slice(0, 120),
            `Made from ${project.name}.`.slice(0, 500),
            JSON.stringify(tasks),
            page ? JSON.stringify(page) : null,
            timezone,
          ],
        )
      ).rows[0];
      reply.code(201);
      return toTemplate(u, await loadTemplate(pool, u, row.id));
    },
  );

  // Start a project from a template: a proposal to review, never a project yet.
  app.post("/templates/:id/use", async (r): Promise<Proposal> => {
    const u = await authenticate(r);
    const raw = (r.params as { id: string }).id;
    const d = templateUseInput.parse(r.body ?? {});
    const starter = TEMPLATE_STARTERS.find((s) => s.id === raw);
    const saved = starter ? null : await loadTemplate(pool, u, idParam(r));
    const template = starter ?? saved!;
    // A team's template starts a team project unless asked otherwise.
    const teamId =
      d.team_id === undefined ? (saved?.team_id ?? null) : d.team_id;
    return transaction((db) =>
      proposeFromTemplate(db, u, template, { title: d.title, team_id: teamId }),
    );
  });
}
