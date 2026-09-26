import {
  dayTime,
  fail,
  localDateKey,
  nextOccurrence,
  type DocBlock,
  type ProjectTemplate,
  type Proposal,
  type TemplateTask,
} from "@orbyn/core";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { type UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { parseProjectDraft } from "../ai/project-draft.js";
import { proposeProject } from "../ai/project-proposal.js";
import { visibleTemplates } from "../../lib/visibility.js";
/**
 * The project templates service: which templates someone can see, reading
 * one, drafting a project from one (proposeFromTemplate), and the worker's
 * rhythm (runDueTemplates). The REST routes, the worker and agents go
 * through these.
 */
export type TemplateRow = {
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

export const COLUMNS = `t.id, t.user_id, t.team_id, tm.name AS team_name, t.name,
  t.description, t.tasks, t.page, t.rrule, t.next_at, t.timezone, t.created_at`;

/** Templates `$1` can see: their own, and their teams'. */
export const VISIBLE = visibleTemplates("t");

/** A template's tasks as a draft the planner can schedule: checked, and ordered. */
export function draftOf(title: string, tasks: TemplateTask[]) {
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

export async function canManageTeam(u: UserRow, teamId: string) {
  const { effective } = await requireTeam(teamId, u, "items:read");
  return effective === "owner" || effective === "admin";
}

export async function toTemplate(
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

export async function loadTemplate(db: Queryable, u: UserRow, id: string) {
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

export const addMinutes = (d: Date, n: number) =>
  new Date(d.getTime() + n * 60_000);
