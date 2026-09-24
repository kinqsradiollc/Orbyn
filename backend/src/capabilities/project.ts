import { z } from "zod";
import { isClosed, projectAtRisk, projectProgress } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
} from "../lib/visibility.js";
import { READ, minutesText, spaceName, uuidOf } from "./common.js";
import {
  both,
  clean,
  cleanTitle,
  labelled,
  mdLink,
  provenanceOf,
  type Provenance,
} from "./format.js";
import { refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";

/**
 * A project as a hub: where it stands, its stages and open tasks, the
 * sessions coming up, its pages (each checked on its own: a team project can
 * hold someone's personal page), promises and decisions, recent changes
 * (marked "via <agent>" where an agent made them) and its health.
 */

const when = z.object({ at: z.string(), local: z.string() });

const taskLine = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.string(),
  priority: z.string(),
  due: when.nullable(),
  assignee: z.string().nullable(),
  estimate_minutes: z.number().nullable(),
});

export const projectOutput = z.object({
  project: z.object({
    id: z.string(),
    uri: z.string(),
    url: z.string(),
    title: z.string(),
    status: z.string(),
    summary: z.string(),
    deadline: when.nullable(),
    team: z.string(),
    team_id: z.string().nullable(),
    provenance: z.string(),
    updated_at: z.string(),
  }),
  progress: z.object({
    tasks_total: z.number(),
    tasks_done: z.number(),
    percent: z.number(),
  }),
  stages: z.array(
    z.object({
      id: z.string().nullable(),
      name: z.string(),
      open_tasks: z.array(taskLine),
    }),
  ),
  sessions: z.array(
    z.object({
      task_id: z.string(),
      task_title: z.string(),
      start: when,
      end: when,
      minutes: z.number(),
    }),
  ),
  docs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      updated_at: z.string(),
      provenance: z.string(),
    }),
  ),
  records: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      status: z.string(),
      due: when.nullable(),
      gap: z.string().nullable(),
    }),
  ),
  activity: z.array(
    z.object({
      at: z.string(),
      summary: z.string(),
      by: z.string().nullable(),
      via_agent: z.string().nullable(),
    }),
  ),
  health: z.object({
    open_tasks: z.number(),
    overdue: z.number(),
    due_this_week: z.number(),
    unscheduled_minutes: z.number(),
    at_risk: z.boolean(),
  }),
});
export type ProjectHub = z.output<typeof projectOutput>;

/** Loads one project the principal can see, or NOT_FOUND. */
export async function projectHub(
  ctx: CapabilityContext,
  id: string,
): Promise<ProjectHub> {
  const tz = ctx.timezone;
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const pid = params.add(id);
  const project = (
    await ctx.db.query<{
      id: string;
      name: string;
      summary: string;
      status: string;
      deadline: Date | null;
      team_id: string | null;
      user_id: string;
      author_name: string | null;
      updated_at: Date;
    }>(
      `SELECT p.id, p.name, p.summary, p.status, p.deadline, p.team_id, p.user_id,
              u.name AS author_name, p.updated_at
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.id = ${pid} AND ${visibleProjects("p", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!project)
    throw new CapabilityError(
      "NOT_FOUND",
      "No project with that id is reachable from this connection.",
      "Search for the project and use its id.",
    );

  const q = (build: (scopeSql: typeof scope, p: Params) => string) => {
    const p = new Params();
    const s = scopeFor(ctx.spaces, p);
    return { sql: build(s, p), values: p.values };
  };
  const tasksQ = q(
    (s, p) => `SELECT i.id, i.title, i.status, i.priority, i.due_at, i.stage_id,
        i.estimate_minutes, i.spent_minutes, a.name AS assignee
      FROM items i LEFT JOIN users a ON a.id = i.assignee_id
     WHERE i.project_id = ${p.add(id)} AND i.status <> 'cancelled'
       AND ${visibleItems("i", s)}
     ORDER BY i.position, i.due_at NULLS LAST LIMIT 300`,
  );
  const docsQ = q(
    (
      s,
      p,
    ) => `SELECT d.id, d.title, d.updated_at, d.user_id, u.name AS author_name,
        d.imported_from IS NOT NULL AS imported
      FROM docs d JOIN users u ON u.id = d.user_id
     WHERE d.project_id = ${p.add(id)} AND ${visibleDocs("d", s)}
     ORDER BY d.updated_at DESC LIMIT 30`,
  );
  const recordsQ = q(
    (
      s,
      p,
    ) => `SELECT w.id, w.kind, w.title, w.status, w.due_at, w.linked_item_id
      FROM work_records w
     WHERE w.project_id = ${p.add(id)} AND ${visibleRecords("w", s)}
       AND w.status IN ('proposed', 'open')
     ORDER BY w.created_at DESC LIMIT 30`,
  );
  // Notes are listed only when this principal can open the page itself.
  const activityQ = q(
    (s, p) => `SELECT a.created_at, a.summary, u.name AS actor,
        CASE WHEN g.id IS NOT NULL THEN coalesce(nullif(g.client_name, ''), nullif(g.name, ''), 'an agent') END AS via_agent
      FROM project_activity a
      LEFT JOIN users u ON u.id = a.actor_id
      LEFT JOIN agent_grants g ON g.id = a.via_grant_id
     WHERE a.project_id = ${p.add(id)}
       AND (a.entity_type <> 'note' OR EXISTS (
             SELECT 1 FROM docs d WHERE d.id = a.entity_id AND ${visibleDocs("d", s)}))
     ORDER BY a.created_at DESC, a.id DESC LIMIT 15`,
  );
  const [stages, tasks, docs, records, activity] = await Promise.all([
    ctx.db.query<{ id: string; name: string }>(
      "SELECT id, name FROM project_stages WHERE project_id = $1 ORDER BY position",
      [id],
    ),
    ctx.db.query<{
      id: string;
      title: string;
      status: string;
      priority: string;
      due_at: Date | null;
      stage_id: string | null;
      estimate_minutes: number | null;
      spent_minutes: number;
      assignee: string | null;
    }>(tasksQ.sql, tasksQ.values),
    ctx.db.query<{
      id: string;
      title: string;
      updated_at: Date;
      user_id: string;
      author_name: string | null;
      imported: boolean;
    }>(docsQ.sql, docsQ.values),
    ctx.db.query<{
      id: string;
      kind: string;
      title: string;
      status: string;
      due_at: Date | null;
      linked_item_id: string | null;
    }>(recordsQ.sql, recordsQ.values),
    ctx.db.query<{
      created_at: Date;
      summary: string;
      actor: string | null;
      via_agent: string | null;
    }>(activityQ.sql, activityQ.values),
  ]);
  const openIds = tasks.rows
    .filter((t) => !isClosed(t.status))
    .map((t) => t.id);
  const horizon = new Date(ctx.now.getTime() + 14 * 86_400_000);
  const sessions = openIds.length
    ? (
        await ctx.db.query<{
          item_id: string;
          start_at: Date;
          end_at: Date;
        }>(
          `SELECT b.item_id, b.start_at, b.end_at FROM time_blocks b
            WHERE b.item_id = ANY ($1::uuid[]) AND b.user_id = $2
              AND b.end_at > $3 AND b.start_at < $4
            ORDER BY b.start_at LIMIT 50`,
          [openIds, ctx.principal.user.id, ctx.now, horizon],
        )
      ).rows
    : [];
  const planned = openIds.length
    ? new Map(
        (
          await ctx.db.query<{ item_id: string; minutes: number }>(
            `SELECT b.item_id,
                    sum(extract(epoch FROM b.end_at - greatest(b.start_at, $2)) / 60)::int AS minutes
               FROM time_blocks b
              WHERE b.item_id = ANY ($1::uuid[]) AND b.end_at > $2
              GROUP BY b.item_id`,
            [openIds, ctx.now],
          )
        ).rows.map((r) => [r.item_id, Number(r.minutes)]),
      )
    : new Map<string, number>();

  const line = (t: (typeof tasks.rows)[number]): z.output<typeof taskLine> => {
    const r = refs({ type: "task", id: t.id });
    return {
      id: r.id,
      title: cleanTitle(t.title) || "Untitled",
      url: r.url,
      status: t.status,
      priority: t.priority,
      due: both(t.due_at, tz),
      assignee: t.assignee ? cleanTitle(t.assignee) : null,
      estimate_minutes: t.estimate_minutes,
    };
  };
  const open = tasks.rows.filter((t) => !isClosed(t.status));
  const inStage = (sid: string | null) =>
    open.filter((t) => t.stage_id === sid).map(line);
  const known = new Set(stages.rows.map((s) => s.id));
  const done = tasks.rows.filter((t) => t.status === "done").length;
  const weekAhead = ctx.now.getTime() + 7 * 86_400_000;
  const titles = new Map(tasks.rows.map((t) => [t.id, t.title]));
  const hubRef = refs({ type: "project", id });
  const counts = { task_count: tasks.rows.length, done_count: done };
  return {
    project: {
      id: hubRef.id,
      uri: hubRef.uri,
      url: hubRef.url,
      title: cleanTitle(project.name) || "Untitled",
      status: project.status,
      summary: clean(project.summary, 4000),
      deadline: both(project.deadline, tz),
      team: spaceName(project.team_id, ctx.principal.teams),
      team_id: project.team_id,
      provenance: provenanceOf(ctx.principal.user.id, project),
      updated_at: project.updated_at.toISOString(),
    },
    progress: {
      tasks_total: tasks.rows.length,
      tasks_done: done,
      percent: projectProgress(counts),
    },
    stages: [
      ...stages.rows.map((s) => ({
        id: s.id,
        name: cleanTitle(s.name),
        open_tasks: inStage(s.id),
      })),
      {
        id: null,
        name: "No stage",
        open_tasks: open
          .filter((t) => !t.stage_id || !known.has(t.stage_id))
          .map(line),
      },
    ].filter((s) => s.id !== null || s.open_tasks.length),
    sessions: sessions.map((b) => ({
      task_id: refs({ type: "task", id: b.item_id }).id,
      task_title: cleanTitle(titles.get(b.item_id) ?? ""),
      start: both(b.start_at, tz)!,
      end: both(b.end_at, tz)!,
      minutes: Math.round((b.end_at.getTime() - b.start_at.getTime()) / 60_000),
    })),
    docs: docs.rows.map((d) => {
      const r = refs({ type: "doc", id: d.id });
      return {
        id: r.id,
        title: cleanTitle(d.title) || "Untitled",
        url: r.url,
        updated_at: d.updated_at.toISOString(),
        provenance: provenanceOf(ctx.principal.user.id, d),
      };
    }),
    records: records.rows.map((w) => ({
      id: refs({ type: "record", id: w.id }).id,
      kind: w.kind,
      title: cleanTitle(w.title),
      status: w.status,
      due: both(w.due_at, tz),
      gap:
        w.kind === "decision" && !w.linked_item_id
          ? "No task delivers this decision yet."
          : null,
    })),
    activity: activity.rows.map((a) => ({
      at: a.created_at.toISOString(),
      summary: cleanTitle(a.summary),
      by: a.actor ? cleanTitle(a.actor) : null,
      via_agent: a.via_agent ? cleanTitle(a.via_agent) : null,
    })),
    health: {
      open_tasks: open.length,
      overdue: open.filter(
        (t) => t.due_at && t.due_at.getTime() < ctx.now.getTime(),
      ).length,
      due_this_week: open.filter(
        (t) =>
          t.due_at &&
          t.due_at.getTime() >= ctx.now.getTime() &&
          t.due_at.getTime() <= weekAhead,
      ).length,
      unscheduled_minutes: open.reduce(
        (sum, t) =>
          sum +
          Math.max(
            0,
            (t.estimate_minutes ?? 0) -
              t.spent_minutes -
              (planned.get(t.id) ?? 0),
          ),
        0,
      ),
      at_risk: projectAtRisk(
        { ...counts, deadline: project.deadline?.toISOString() ?? null },
        ctx.now,
      ),
    },
  };
}

/** A project hub as Markdown. */
export function projectMarkdown(h: ProjectHub): string {
  const p = h.project;
  const out = [
    `# ${mdLink(p.title, p.url)}`,
    `${p.team} · ${p.status} · ${h.progress.tasks_done} of ${h.progress.tasks_total} tasks done (${h.progress.percent}%)` +
      (p.deadline ? ` · deadline ${p.deadline.local}` : "") +
      (h.health.at_risk ? " · at risk" : ""),
  ];
  if (p.summary) out.push("", labelled(p.summary, p.provenance as Provenance));
  out.push(
    "",
    `Health: ${h.health.open_tasks} open, ${h.health.overdue} overdue, ${h.health.due_this_week} due this week, ${minutesText(h.health.unscheduled_minutes)} of estimated work not yet planned.`,
  );
  for (const s of h.stages) {
    if (!s.open_tasks.length) continue;
    out.push("", `## ${s.name}`);
    for (const t of s.open_tasks)
      out.push(
        `- ${mdLink(t.title, t.url)} (${t.status}${t.due ? `, due ${t.due.local}` : ""}${t.assignee ? `, ${t.assignee}` : ""}) · ${t.id}`,
      );
  }
  if (h.sessions.length) {
    out.push("", "## Sessions ahead");
    for (const s of h.sessions)
      out.push(`- ${s.start.local}, ${s.minutes} min: ${s.task_title}`);
  }
  if (h.docs.length) {
    out.push("", "## Pages");
    for (const d of h.docs) out.push(`- ${mdLink(d.title, d.url)} · ${d.id}`);
  }
  if (h.records.length) {
    out.push("", "## Promises and decisions");
    for (const r of h.records)
      out.push(
        `- ${r.kind}: ${r.title} (${r.status}${r.due ? `, due ${r.due.local}` : ""})${r.gap ? ` — ${r.gap}` : ""}`,
      );
  }
  if (h.activity.length) {
    out.push("", "## Recent changes");
    for (const a of h.activity)
      out.push(
        `- ${a.at.slice(0, 16).replace("T", " ")} ${a.summary}${a.by ? ` (${a.by}${a.via_agent ? ` via ${a.via_agent}` : ""})` : ""}`,
      );
  }
  return out.join("\n");
}

export const getProject = defineCapability({
  name: "get_project",
  title: "Open a project",
  description:
    "A project as a hub: summary, status and deadline; stages with their open tasks; your sessions in the next two weeks; its pages; open promises and decisions (flagging decisions no task delivers); recent changes, marked with the agent that made them; and health (overdue, due this week, estimated work not yet planned, at risk).",
  input: z
    .object({
      project: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe("The project: project:<id>, its id or its link."),
    })
    .strict(),
  output: projectOutput,
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const hub = await projectHub(ctx, uuidOf(a.project, "project"));
    return {
      structured: hub,
      markdown: projectMarkdown(hub),
      links: [
        {
          uri: hub.project.uri,
          name: hub.project.title,
          description: "The project",
        },
      ],
      targets: [hub.project.id],
    };
  },
});
