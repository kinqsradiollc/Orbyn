import type { FastifyInstance } from "fastify";
import {
  dayTime,
  fail,
  localDateKey,
  nextOccurrence,
  TEMPLATE_STARTERS,
  templateInput,
  templateUpdate,
  templateUseInput,
  type DocBlock,
  type ProjectTemplate,
  type Proposal,
  type TemplateTask,
} from "@orbyn/core";
import { pool, reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { parseProjectDraft } from "../ai/project-draft.js";
import { proposeProject } from "../ai/project-proposal.js";

import { visibleProjects, visibleTemplates } from "../../lib/visibility.js";
type TemplateRow = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  name: string;
  description: string;
  tasks: TemplateTask[];
  page: { title: string; content: DocBlock[] } | null;
  rrule: string | null;
  next_at: Date | null;
  timezone: string;
  created_at: Date;
};

const COLUMNS = `t.id, t.user_id, t.team_id, tm.name AS team_name, t.name,
  t.description, t.tasks, t.page, t.rrule, t.next_at, t.timezone, t.created_at`;

/** Templates `$1` can see: their own, and their teams'. */
const VISIBLE = visibleTemplates("t");

/** A template's tasks as a draft the planner can schedule: checked, and ordered. */
function draftOf(title: string, tasks: TemplateTask[]) {
  try {
    return parseProjectDraft(
      JSON.stringify({
        title,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          notes: t.notes,
          estimate_minutes: t.estimate_minutes,
          due_in_days: t.due_in_days,
          depends_on: t.depends_on,
        })),
      }),
    );
  } catch (e) {
    fail(
      422,
      `The template's tasks don't fit together: ${(e as Error).message}.`,
    );
  }
}

/** When a template with a rhythm next starts itself: 8 am on its next day. */
export function nextRun(rrule: string, timezone: string, after: Date) {
  const start = dayTime(localDateKey(after, timezone), 8 * 60, timezone);
  return nextOccurrence(start, rrule, timezone, after);
}

async function canManageTeam(u: UserRow, teamId: string) {
  const { effective } = await requireTeam(teamId, u, "items:read");
  return effective === "owner" || effective === "admin";
}

async function toTemplate(
  u: UserRow,
  r: TemplateRow,
): Promise<ProjectTemplate> {
  return {
    id: r.id,
    source: r.team_id ? "team" : "personal",
    name: r.name,
    description: r.description,
    team_id: r.team_id,
    team_name: r.team_name,
    tasks: r.tasks,
    page: r.page,
    rrule: r.rrule,
    next_at: r.next_at?.toISOString() ?? null,
    can_edit: r.team_id
      ? await canManageTeam(u, r.team_id)
      : r.user_id === u.id,
    created_at: r.created_at.toISOString(),
  };
}

async function loadTemplate(db: Queryable, u: UserRow, id: string) {
  const row = (
    await db.query<TemplateRow>(
      `SELECT ${COLUMNS} FROM project_templates t
         LEFT JOIN teams tm ON tm.id = t.team_id
        WHERE t.id = $2 AND ${VISIBLE}`,
      [u.id, id],
    )
  ).rows[0];
  if (!row) fail(404, "Template not found");
  return row;
}

/**
 * Start a project from a template: a proposal with its schedule, to review.
 * Nothing exists until it's approved.
 */
export async function proposeFromTemplate(
  db: Queryable,
  u: UserRow,
  template: {
    id: string;
    name: string;
    tasks: TemplateTask[];
    page: { title: string; content: DocBlock[] } | null;
  },
  options: { title?: string; team_id?: string | null } = {},
  now = new Date(),
): Promise<Proposal> {
  const teamId = options.team_id ?? null;
  if (teamId) await requireTeam(teamId, u, "items:write");
  const title = options.title ?? template.name;
  const draft = draftOf(title, template.tasks);
  const { timezone } = await loadPrefs(db, u.id);
  const proposal = await proposeProject(db, u.id, draft, timezone, now);
  const measures = Object.fromEntries(
    template.tasks
      .filter((t) => t.target_value != null)
      .map((t) => [
        t.id,
        { target_value: t.target_value!, value_unit: t.value_unit },
      ]),
  );
  const extra = {
    page: template.page,
    team_id: teamId,
    measures,
    template_id: template.id,
  };
  await db.query(
    `UPDATE proposals SET project = project || $2::jsonb,
       expires_at = now() + interval '1 hour'
     WHERE id = $1`,
    [proposal.id, JSON.stringify(extra)],
  );
  return { ...proposal, project: { ...proposal.project!, ...extra } };
}

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
      const project = (
        await pool.query<{
          id: string;
          name: string;
          team_id: string | null;
          user_id: string;
          doc_id: string | null;
          created_at: Date;
        }>(
          `SELECT p.id, p.name, p.team_id, p.user_id, p.doc_id, p.created_at
             FROM projects p
            WHERE p.id = $2 AND ${visibleProjects("p")}`,
          [u.id, projectId],
        )
      ).rows[0];
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

/**
 * Templates with a rhythm whose time has come: tell their owner it's ready
 * to start (opening it makes the proposal, from the calendar as it is then),
 * and move on to the next time. Called by the worker.
 */
export async function runDueTemplates(now = new Date()) {
  const due = await transaction(async (db) => {
    const rows = (
      await db.query<{
        id: string;
        user_id: string;
        name: string;
        rrule: string;
        timezone: string;
        next_at: Date;
      }>(
        `SELECT id, user_id, name, rrule, timezone, next_at FROM project_templates
          WHERE next_at IS NOT NULL AND next_at <= $1
          ORDER BY next_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
        [now],
      )
    ).rows;
    for (const t of rows)
      await db.query(
        "UPDATE project_templates SET next_at = $2 WHERE id = $1",
        [t.id, nextRun(t.rrule, t.timezone, addMinutes(now, 1))],
      );
    return rows;
  });
  for (const t of due)
    await pool.query(
      `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
         title, body, state, kind, ref)
       SELECT $1::uuid, NULL, 0, c.channel, c.destination, $2, $3,
         CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'template', $4
       FROM users u
       CROSS JOIN LATERAL (
         SELECT 'inapp' AS channel, u.id::text AS destination
         UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
       ) c
       WHERE u.id = $1::uuid AND NOT u.disabled
       ON CONFLICT DO NOTHING`,
      [
        t.user_id,
        `${t.name} is ready to start`.slice(0, 200),
        `Review this ${localDateKey(t.next_at, t.timezone)} run of ${t.name} and approve it to make the project.`.slice(
          0,
          2000,
        ),
        t.id,
      ],
    );
  return due.length;
}

const addMinutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);
