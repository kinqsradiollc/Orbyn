import { z } from "zod";
import {
  deadlineOf,
  serializeBlock,
  type DocBlock,
  type TemplateTask,
} from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
  visibleRecords,
  visibleTemplates,
  visibleViews,
} from "../lib/visibility.js";
import { describeSavedView, fromSavedView } from "./query-def.js";
import { findView } from "./view-store.js";
import { jobs } from "../modules/imports/service.js";
import { runView } from "./query.js";
import { READ, minutesText, spaceName } from "./common.js";
import {
  MAX_RESULT_CHARS,
  both,
  clean,
  cleanTitle,
  fence,
  fencedTitle,
  labelled,
  lineTitle,
  mdLink,
  outsideHeading,
  provenanceOf,
  titleFor,
} from "./format.js";
import { projectHub, projectMarkdown } from "./project.js";
import { parseRef, refs, type Ref, type RefType } from "./refs.js";
import { docEditorsSql, itemSourceSql } from "./sources.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { proposalOutcome } from "../modules/proposals/service.js";
import { readableLinks } from "../modules/links/privacy.js";

/**
 * Opening one thing by id. Follows OpenAI's fetch contract: the input is
 * `id`, and the answer is {id, title, text, url, metadata}, with the text
 * content the JSON of that. Pages come back as Markdown with each line's
 * anchor (` ^b…`), in parts when long (metadata.next_block).
 */

const FETCH_TYPES = [
  "task",
  "event",
  "doc",
  "project",
  "record",
  "template",
  "proposal",
  "view",
  "import",
] as const;

const output = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  metadata: z.object({
    type: z.enum(FETCH_TYPES),
    uri: z.string(),
    team: z.string(),
    team_id: z.string().nullable(),
    project_id: z.string().nullable(),
    status: z.string().nullable(),
    version: z.number().nullable(),
    updated_at: z.string().nullable(),
    provenance: z.string(),
    truncated: z.boolean(),
    next_block: z.string().nullable(),
  }),
});
type Fetched = z.output<typeof output>;

/** How much page text one fetch returns before continuing with next_block. */
const PAGE_CHARS = MAX_RESULT_CHARS - 4_000;

/** Whether this connection leaves out text from outside Orbyn. */
const hide = (ctx: CapabilityContext) =>
  ctx.principal.flags.hide_outside_content;

const notFound = () =>
  new CapabilityError(
    "NOT_FOUND",
    "Nothing with that id is reachable from this connection.",
    "Search for it and use an id from the results.",
  );

/** One visible row by id, or undefined. */
async function visibleRow<T extends Record<string, unknown>>(
  ctx: CapabilityContext,
  build: (scope: ReturnType<typeof scopeFor>, id: string) => string,
  id: string,
): Promise<T | undefined> {
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  return (await ctx.db.query<T>(build(scope, p.add(id)), p.values)).rows[0];
}

async function fetchTask(ctx: CapabilityContext, ref: Ref): Promise<Fetched> {
  const tz = ctx.timezone;
  type Row = {
    id: string;
    title: string;
    notes: string;
    kind: string;
    status: string;
    priority: string;
    due_at: Date | null;
    end_at: Date | null;
    all_day: boolean;
    timezone: string;
    rrule: string | null;
    location: string;
    estimate_minutes: number | null;
    spent_minutes: number;
    progress: number;
    team_id: string | null;
    user_id: string;
    author_name: string | null;
    project_id: string | null;
    project_name: string | null;
    stage_name: string | null;
    list_name: string | null;
    assignee: string | null;
    version: number;
    updated_at: Date;
    attendee_count: number;
    source: string | null;
  };
  const t = await visibleRow<Row>(
    ctx,
    (s, id) => `SELECT i.id, i.title, i.notes, i.kind, i.status, i.priority,
        i.due_at, i.end_at, i.all_day, i.timezone, i.rrule, i.location, i.estimate_minutes,
        i.spent_minutes, i.progress, i.team_id, i.user_id, u.name AS author_name,
        i.project_id, p.name AS project_name, st.name AS stage_name,
        l.name AS list_name, a.name AS assignee, i.version, i.updated_at,
        (SELECT count(*)::int FROM item_attendees x WHERE x.item_id = i.id) AS attendee_count,
        ${itemSourceSql("i")} AS source
      FROM items i JOIN users u ON u.id = i.user_id
      LEFT JOIN projects p ON p.id = i.project_id
      LEFT JOIN project_stages st ON st.id = i.stage_id
      LEFT JOIN lists l ON l.id = i.list_id
      LEFT JOIN users a ON a.id = i.assignee_id
     WHERE i.id = ${id} AND ${visibleItems("i", s)}`,
    ref.id,
  );
  if (!t) throw notFound();
  const [steps, sessions, tags] = await Promise.all([
    ctx.db.query<{
      id: string;
      title: string;
      kind: string;
      status: string;
      source: string | null;
    }>(
      `SELECT c.id, c.title, c.kind, c.status, ${itemSourceSql("c")} AS source
         FROM items c WHERE c.parent_id = $1
        ORDER BY c.position, c.created_at LIMIT 100`,
      [t.id],
    ),
    ctx.db.query<{ start_at: Date; end_at: Date }>(
      `SELECT start_at, end_at FROM time_blocks
        WHERE item_id = $1 AND user_id = $2 AND end_at > $3
        ORDER BY start_at LIMIT 30`,
      [
        t.id,
        ctx.principal.user.id,
        new Date(ctx.now.getTime() - 7 * 86_400_000),
      ],
    ),
    ctx.db.query<{ name: string }>(
      "SELECT g.name FROM item_tags it JOIN tags g ON g.id = it.tag_id WHERE it.item_id = $1 ORDER BY g.name",
      [t.id],
    ),
  ]);
  const provenance = provenanceOf(ctx.principal.user.id, t);
  const event = t.kind === "event";
  const type: RefType = event ? "event" : "task";
  // One occurrence of a repeating event, when asked for.
  const start = ref.occurrence ? new Date(ref.occurrence) : t.due_at;
  const length =
    t.due_at && t.end_at ? t.end_at.getTime() - t.due_at.getTime() : 0;
  const end = start && t.end_at ? new Date(start.getTime() + length) : null;
  const r = refs({
    type,
    id: t.id,
    ...(ref.occurrence ? { occurrence: ref.occurrence } : {}),
  });
  // The moment a task is due by, as the apps measure it (`deadlineOf`): the
  // end of an all-day task's day, or the end of one with an end time.
  const deadline = event ? null : deadlineOf(t);
  const deadlineMs = deadline ? Date.parse(deadline) : null;
  const afterDeadline = (b: { end_at: Date }) =>
    deadlineMs !== null && b.end_at.getTime() > deadlineMs;
  const futureBefore = sessions.rows.filter(
    (b) => b.end_at.getTime() > ctx.now.getTime() && !afterDeadline(b),
  );
  const plannedBefore = futureBefore.reduce(
    (m, b) => m + (b.end_at.getTime() - b.start_at.getTime()) / 60_000,
    0,
  );
  const title = titleFor(t.title, provenance, hide(ctx), t.kind) || "Untitled";
  // A title made from outside text (what a booking guest typed, an email's
  // subject) goes in the fence (or is left out), never in the heading.
  const heading = outsideHeading(provenance, t.kind);
  const lines = [
    `# ${heading ?? title}`,
    ...(heading && !hide(ctx) ? [fence(title, provenance)] : []),
    `- ${event ? "Event" : t.kind === "reminder" ? "Reminder" : "Task"} · ${t.status} · ${t.priority} priority · ${spaceName(t.team_id, ctx.principal.teams)}`,
  ];
  if (start)
    lines.push(
      `- ${event ? "When" : "Due (deadline)"}: ${both(start, tz)!.local}${end ? ` – ${both(end, tz)!.local}` : ""} (${start.toISOString()})${deadline && Date.parse(deadline) !== start.getTime() ? ` · due by ${both(deadline, tz)!.local}` : ""}${t.rrule ? ` · repeats (${t.rrule})` : ""}`,
    );
  if (t.project_name)
    lines.push(
      `- Project: ${mdLink(cleanTitle(t.project_name), refs({ type: "project", id: t.project_id! }).url)}${t.stage_name ? ` › ${cleanTitle(t.stage_name)}` : ""}`,
    );
  if (t.list_name) lines.push(`- List: ${cleanTitle(t.list_name)}`);
  if (tags.rows.length)
    lines.push(
      `- Tags: ${tags.rows.map((g) => cleanTitle(g.name)).join(", ")}`,
    );
  if (t.assignee) lines.push(`- Assigned to ${cleanTitle(t.assignee)}`);
  // An email's subject can set the place too: fenced like the title, and
  // left out with it.
  if (t.location && provenance !== "inbound_email")
    lines.push(`- Where: ${clean(t.location, 300)}`);
  else if (t.location && !hide(ctx))
    lines.push(`- Where: ${fencedTitle(t.location, provenance)}`);
  if (event && t.attendee_count) lines.push(`- ${t.attendee_count} invited`);
  if (!event && (t.estimate_minutes || t.spent_minutes))
    lines.push(
      `- Estimate ${t.estimate_minutes ? minutesText(t.estimate_minutes) : "not set"} · ${minutesText(t.spent_minutes)} spent · ${Math.round(plannedBefore)} min planned before the deadline`,
    );
  if (sessions.rows.length) {
    lines.push("", "## Sessions");
    for (const b of sessions.rows)
      lines.push(
        `- ${both(b.start_at, tz)!.local} – ${both(b.end_at, tz)!.local}${afterDeadline(b) ? " (after the deadline)" : ""}`,
      );
  }
  if (steps.rows.length) {
    lines.push("", "## Steps");
    for (const s of steps.rows)
      lines.push(
        `- [${s.status === "done" ? "x" : " "}] ${lineTitle(titleFor(s.title, s.source ?? "you", hide(ctx), s.kind) || "Untitled", null, s.source ?? "you", s.kind)} · ${s.kind === "event" ? "event" : "task"}:${s.id}`,
      );
  }
  if (t.notes.trim())
    lines.push("", "## Notes", labelled(t.notes, provenance, hide(ctx)));
  return {
    id: r.id,
    title,
    text: lines.join("\n"),
    url: r.url,
    metadata: {
      type,
      uri: r.uri,
      team: spaceName(t.team_id, ctx.principal.teams),
      team_id: t.team_id,
      project_id: t.project_id,
      status: t.status,
      version: t.version,
      updated_at: t.updated_at.toISOString(),
      provenance,
      truncated: false,
      next_block: null,
    },
  };
}

/** A block as Markdown with its anchor, so edits and citations can point at it. */
function anchored(b: DocBlock): string {
  const text = serializeBlock(b);
  if (!b.id) return text;
  return b.type === "code" || b.type === "math" || b.type === "divider"
    ? `${text}\n^${b.id}`
    : `${text} ^${b.id}`;
}

async function fetchDoc(
  ctx: CapabilityContext,
  ref: Ref,
  from: string | undefined,
): Promise<Fetched> {
  const d = await visibleRow<{
    id: string;
    title: string;
    kind: string;
    content: DocBlock[];
    team_id: string | null;
    user_id: string;
    author_name: string | null;
    imported: boolean;
    project_id: string | null;
    folder_name: string | null;
    version: number;
    updated_at: Date;
    editors: string[] | null;
  }>(
    ctx,
    (s, id) => `SELECT d.id, d.title, d.kind, d.content, d.team_id, d.user_id,
        u.name AS author_name, d.imported_from IS NOT NULL AS imported,
        d.project_id, f.name AS folder_name, d.version, d.updated_at,
        ${docEditorsSql("d", s.user)} AS editors
      FROM docs d JOIN users u ON u.id = d.user_id
      LEFT JOIN folders f ON f.id = d.folder_id
     WHERE d.id = ${id} AND ${visibleDocs("d", s)}`,
    ref.id,
  );
  if (!d) throw notFound();
  // Links to what this connection can't open keep no title (D3aF).
  const blocks = await readableLinks(
    ctx.db,
    ctx.spaces,
    Array.isArray(d.content) ? d.content : [],
  );
  const indexOf = (anchor: string | undefined) => {
    if (!anchor) return -1;
    const at = /^@(\d{1,6})$/.exec(anchor);
    if (at) return Number(at[1]) < blocks.length ? Number(at[1]) : -1;
    return blocks.findIndex((b) => b.id === anchor);
  };
  let start = 0;
  if (from !== undefined) {
    start = indexOf(from);
    if (start < 0)
      throw new CapabilityError(
        "INVALID",
        "That next_block isn't a line of this page.",
        "Use the next_block from the previous fetch of this page.",
      );
  } else if (ref.block) {
    start = indexOf(ref.block);
    if (start < 0)
      throw new CapabilityError(
        "NOT_FOUND",
        "That line isn't on the page any more.",
        `Fetch doc:${d.id} for the whole page.`,
      );
  }
  const parts: string[] = [];
  let size = 0;
  let next: string | null = null;
  for (let i = start; i < blocks.length; i++) {
    const text = anchored(blocks[i]);
    if (size + text.length > PAGE_CHARS && parts.length) {
      next = blocks[i].id ?? `@${i}`;
      break;
    }
    parts.push(text);
    size += text.length + 2;
  }
  const provenance = provenanceOf(ctx.principal.user.id, d);
  const body = parts.join("\n\n");
  const r = refs({
    type: "doc",
    id: d.id,
    ...(ref.block ? { block: ref.block } : {}),
  });
  const header = [
    `# ${cleanTitle(d.title) || "Untitled"}`,
    `${spaceName(d.team_id, ctx.principal.teams)}${d.folder_name ? ` · folder ${cleanTitle(d.folder_name)}` : ""} · version ${d.version} · changed ${d.updated_at.toISOString()}`,
    start > 0 ? `(From line ${start + 1} of ${blocks.length}.)` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const tail = next
    ? `\n\n[The page continues: fetch again with next_block "${next}".]`
    : "";
  return {
    id: refs({ type: "doc", id: d.id }).id,
    title: cleanTitle(d.title) || "Untitled",
    text: `${header}\n\n${body ? labelled(body, provenance, hide(ctx)) : "(empty page)"}${tail}`,
    url: r.url,
    metadata: {
      type: "doc",
      uri: r.uri,
      team: spaceName(d.team_id, ctx.principal.teams),
      team_id: d.team_id,
      project_id: d.project_id,
      status: d.kind,
      version: d.version,
      updated_at: d.updated_at.toISOString(),
      provenance,
      truncated: next !== null,
      next_block: next,
    },
  };
}

async function fetchProject(
  ctx: CapabilityContext,
  ref: Ref,
): Promise<Fetched> {
  const hub = await projectHub(ctx, ref.id);
  return {
    id: hub.project.id,
    title: hub.project.title,
    text: projectMarkdown(hub),
    url: hub.project.url,
    metadata: {
      type: "project",
      uri: hub.project.uri,
      team: hub.project.team,
      team_id: hub.project.team_id,
      project_id: ref.id,
      status: hub.project.status,
      version: null,
      updated_at: hub.project.updated_at,
      provenance: hub.project.provenance,
      truncated: false,
      next_block: null,
    },
  };
}

async function fetchRecord(ctx: CapabilityContext, ref: Ref): Promise<Fetched> {
  const w = await visibleRow<{
    id: string;
    kind: string;
    title: string;
    details: string;
    outcome: string;
    status: string;
    due_at: Date | null;
    review_at: Date | null;
    team_id: string | null;
    user_id: string;
    author_name: string | null;
    owner: string | null;
    project_id: string | null;
    linked_item_id: string | null;
    version: number;
    updated_at: Date;
  }>(
    ctx,
    (s, id) => `SELECT w.id, w.kind, w.title, w.details, w.outcome, w.status,
        w.due_at, w.review_at, w.team_id, w.created_by AS user_id,
        u.name AS author_name, o.name AS owner, w.project_id, w.linked_item_id,
        w.version, w.updated_at
      FROM work_records w JOIN users u ON u.id = w.created_by
      LEFT JOIN users o ON o.id = w.owner_id
     WHERE w.id = ${id} AND ${visibleRecords("w", s)}`,
    ref.id,
  );
  if (!w) throw notFound();
  const provenance = provenanceOf(ctx.principal.user.id, w);
  const r = refs({ type: "record", id: w.id }, w.project_id);
  const lines = [
    `# ${w.kind[0].toUpperCase()}${w.kind.slice(1)}: ${cleanTitle(w.title)}`,
    `- ${w.status}${w.owner ? ` · owner ${cleanTitle(w.owner)}` : ""}${w.due_at ? ` · due ${both(w.due_at, ctx.timezone)!.local}` : ""}${w.review_at ? ` · review ${both(w.review_at, ctx.timezone)!.local}` : ""}`,
  ];
  if (w.project_id)
    lines.push(`- Project: ${refs({ type: "project", id: w.project_id }).url}`);
  if (w.linked_item_id) lines.push(`- Delivered by task:${w.linked_item_id}`);
  if (w.details.trim())
    lines.push("", labelled(w.details, provenance, hide(ctx)));
  if (w.outcome.trim())
    lines.push("", "## Outcome", labelled(w.outcome, provenance, hide(ctx)));
  return {
    id: r.id,
    title: cleanTitle(w.title),
    text: lines.join("\n"),
    url: r.url,
    metadata: {
      type: "record",
      uri: r.uri,
      team: spaceName(w.team_id, ctx.principal.teams),
      team_id: w.team_id,
      project_id: w.project_id,
      status: w.status,
      version: w.version,
      updated_at: w.updated_at.toISOString(),
      provenance,
      truncated: false,
      next_block: null,
    },
  };
}

async function fetchTemplate(
  ctx: CapabilityContext,
  ref: Ref,
): Promise<Fetched> {
  const t = await visibleRow<{
    id: string;
    name: string;
    description: string;
    tasks: TemplateTask[];
    rrule: string | null;
    team_id: string | null;
    user_id: string;
    author_name: string | null;
    updated_at: Date;
  }>(
    ctx,
    (s, id) => `SELECT t.id, t.name, t.description, t.tasks, t.rrule, t.team_id,
        t.user_id, u.name AS author_name, t.updated_at
      FROM project_templates t JOIN users u ON u.id = t.user_id
     WHERE t.id = ${id} AND ${visibleTemplates("t", s)}`,
    ref.id,
  );
  if (!t) throw notFound();
  const provenance = provenanceOf(ctx.principal.user.id, t);
  const r = refs({ type: "template", id: t.id });
  const tasks = Array.isArray(t.tasks) ? t.tasks : [];
  const lines = [
    `# Template: ${cleanTitle(t.name)}`,
    t.rrule ? `Starts a project on a rhythm (${t.rrule}).` : "",
    t.description ? labelled(t.description, provenance, hide(ctx)) : "",
    "",
    "## Tasks",
    ...tasks.map(
      (task) =>
        `- ${cleanTitle((task as { title?: string }).title ?? "")}${(task as { stage?: string }).stage ? ` (${cleanTitle((task as { stage?: string }).stage)})` : ""}`,
    ),
  ].filter((l, i) => l !== "" || i === 3);
  return {
    id: r.id,
    title: cleanTitle(t.name),
    text: lines.join("\n"),
    url: r.url,
    metadata: {
      type: "template",
      uri: r.uri,
      team: spaceName(t.team_id, ctx.principal.teams),
      team_id: t.team_id,
      project_id: null,
      status: null,
      version: null,
      updated_at: t.updated_at.toISOString(),
      provenance,
      truncated: false,
      next_block: null,
    },
  };
}

/** An id that names no type: try each kind of thing in turn. */
type Plain = "task" | "doc" | "project" | "record" | "template" | "view";

async function whichType(ctx: CapabilityContext, id: string): Promise<Plain> {
  const tries: [Plain, string][] = [
    ["task", "SELECT 1 FROM items i WHERE i.id = $ID AND VIS"],
    ["doc", "SELECT 1 FROM docs d WHERE d.id = $ID AND VIS"],
    ["project", "SELECT 1 FROM projects p WHERE p.id = $ID AND VIS"],
    ["record", "SELECT 1 FROM work_records w WHERE w.id = $ID AND VIS"],
    ["template", "SELECT 1 FROM project_templates t WHERE t.id = $ID AND VIS"],
    ["view", "SELECT 1 FROM saved_views v WHERE v.id = $ID AND VIS"],
  ];
  const vis = {
    task: visibleItems,
    doc: visibleDocs,
    project: visibleProjects,
    record: visibleRecords,
    template: visibleTemplates,
    view: visibleViews,
  };
  const alias = {
    task: "i",
    doc: "d",
    project: "p",
    record: "w",
    template: "t",
    view: "v",
  };
  for (const [type, sql] of tries) {
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const at = p.add(id);
    const found = await ctx.db.query(
      sql.replace("$ID", at).replace("VIS", vis[type](alias[type], scope)),
      p.values,
    );
    if (found.rowCount) return type;
  }
  throw notFound();
}

/** An exact title: the one thing with it, or AMBIGUOUS with candidates. */
async function byTitle(ctx: CapabilityContext, title: string): Promise<Ref> {
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  const t = p.add(title.slice(0, 300));
  const found = await ctx.db.query<{
    type: RefType;
    id: string;
    title: string;
    source: string | null;
  }>(
    `(SELECT CASE WHEN i.kind = 'event' THEN 'event' ELSE 'task' END AS type, i.id, i.title,
             ${itemSourceSql("i")} AS source
        FROM items i WHERE lower(i.title) = lower(${t}) AND ${visibleItems("i", scope)} LIMIT 6)
     UNION ALL
     (SELECT 'doc', d.id, d.title, NULL FROM docs d
       WHERE lower(d.title) = lower(${t}) AND ${visibleDocs("d", scope)} LIMIT 6)
     UNION ALL
     (SELECT 'project', p.id, p.name, NULL FROM projects p
       WHERE lower(p.name) = lower(${t}) AND ${visibleProjects("p", scope)} LIMIT 6)`,
    p.values,
  );
  if (found.rows.length === 1)
    return { type: found.rows[0].type, id: found.rows[0].id };
  if (!found.rows.length)
    throw new CapabilityError(
      "NOT_FOUND",
      "Nothing reachable has exactly that title.",
      "Use search to find it, then fetch by id.",
    );
  const candidates = found.rows.slice(0, 5).map((r) => ({
    id: refs({ type: r.type, id: r.id }).id,
    title: titleFor(r.title, r.source ?? "you", hide(ctx), r.type),
  }));
  throw new CapabilityError(
    "AMBIGUOUS",
    `${found.rows.length > 5 ? "More than 5" : found.rows.length} things have that title: ${candidates.map((c) => `${c.id} "${c.title}"`).join(", ")}.`,
    "Fetch one of them by id.",
    { candidates },
  );
}

/** Opens `input` (any form of id) for the principal. */
/**
 * What became of a proposal this connection made: waiting, applied,
 * declined, cancelled or expired. Only its own connection's proposals (the
 * person's own session sees all of theirs).
 */
async function fetchProposal(
  ctx: CapabilityContext,
  ref: Ref,
): Promise<Fetched> {
  const p = ctx.principal;
  const found = await proposalOutcome(ctx.db, p.user.id, p.grant_id, ref.id);
  if (!found) throw notFound();
  const r = refs({ type: "proposal", id: found.id });
  const status: Record<string, string> = {
    pending: "Waiting for the person's approval in Orbyn's Review inbox.",
    applied: "Approved: the changes were made.",
    declined: "Declined: nothing changed.",
    cancelled:
      "Cancelled (the connection or the team's agent access changed): nothing changed.",
    expired: "Expired before anyone decided: nothing changed.",
  };
  return {
    id: r.id,
    title: cleanTitle(found.summary) || "Proposal",
    text: [
      `# Proposal: ${cleanTitle(found.summary) || "changes"}`,
      `- ${status[found.status] ?? found.status}`,
      `- ${found.changes} change${found.changes === 1 ? "" : "s"}${found.decided_at ? ` · decided ${both(new Date(found.decided_at), ctx.timezone)!.local}` : ""}`,
      `- Review: ${found.review_url}`,
    ].join("\n"),
    url: found.review_url,
    metadata: {
      type: "proposal",
      uri: r.uri,
      team: "Personal",
      team_id: null,
      project_id: null,
      status: found.status,
      version: null,
      updated_at: found.decided_at,
      provenance: "you",
      truncated: false,
      next_block: null,
    },
  };
}

/**
 * A saved view, run: its definition in words and its first 50 rows as a
 * Markdown table (query with the view pages through the rest).
 */
async function fetchView(ctx: CapabilityContext, ref: Ref): Promise<Fetched> {
  const view = await findView(ctx.db, ctx.spaces, ref.id);
  if (!view) throw notFound();
  const { query, notes } = fromSavedView(view.definition);
  const { rows, more } = await runView(ctx, query, 50, 0);
  const r = refs({ type: "view", id: view.id });
  const name = cleanTitle(view.name) || "Untitled view";
  const cell = (t: string) => t.replace(/\|/g, "/").replace(/\n/g, " ");
  const text = [
    `# ${name}`,
    `${describeSavedView(view.definition)} · ${spaceName(view.team_id, ctx.principal.teams)}`,
    ...(notes.length ? [`In the app, also: ${notes.join("; ")}.`] : []),
    "",
    ...(rows.length
      ? [
          `| ${query.group_by ? "Group | " : ""}Title | Status | Due | Id |`,
          `|${query.group_by ? " --- |" : ""} --- | --- | --- | --- |`,
          ...rows.map(
            (row) =>
              `| ${row.group !== null ? `${cell(row.group)} | ` : ""}${cell(lineTitle(row.title, row.url, row.provenance, row.type))} | ${row.status ?? ""} | ${row.due?.local ?? ""} | ${row.id} |`,
          ),
        ]
      : ["Nothing matches right now."]),
    ...(more ? ["", `More rows: query with view "${r.id}".`] : []),
  ].join("\n");
  return {
    id: r.id,
    title: name,
    text,
    url: r.url,
    metadata: {
      type: "view",
      uri: r.uri,
      team: spaceName(view.team_id, ctx.principal.teams),
      team_id: view.team_id,
      project_id: view.definition.filters.project ?? null,
      status: view.definition.layout,
      version: view.version,
      updated_at: view.updated_at,
      provenance:
        view.user_id === ctx.principal.user.id ? "you" : "teammate:a teammate",
      truncated: more,
      next_block: null,
    },
  };
}

/** An import into Docs: its status, and the page it became once ready. */
async function fetchImport(ctx: CapabilityContext, ref: Ref): Promise<Fetched> {
  if (!ctx.principal.personal) throw notFound();
  const job = (await jobs(ctx.db, ctx.principal.user.id, ref.id))[0];
  if (!job) throw notFound();
  const page = job.doc_id ? refs({ type: "doc", id: job.doc_id }) : null;
  const r = refs({ type: "import", id: job.id });
  return {
    id: r.id,
    title: cleanTitle(job.file_name),
    text: [
      `# Import: ${cleanTitle(job.file_name)}`,
      `- ${job.status}${job.pages ? `, ${job.pages} pages` : ""}`,
      ...(job.error ? [`- ${clean(job.error, 500)}`] : []),
      ...(page ? [`- Page: ${page.id} · ${page.url}`] : []),
    ].join("\n"),
    url: page?.url ?? r.url,
    metadata: {
      type: "import",
      uri: r.uri,
      team: "Personal",
      team_id: null,
      project_id: null,
      status: job.status,
      version: null,
      updated_at: job.finished_at,
      provenance: "import",
      truncated: false,
      next_block: null,
    },
  };
}

export async function fetchAny(
  ctx: CapabilityContext,
  input: string,
  nextBlock?: string,
): Promise<Fetched> {
  const parsed = parseRef(input);
  let ref: Ref;
  if (parsed.type === "title") ref = await byTitle(ctx, parsed.text);
  else if (parsed.type === "any")
    ref = {
      type: await whichType(ctx, parsed.id),
      id: parsed.id,
      ...(parsed.block ? { block: parsed.block } : {}),
    };
  else ref = parsed;
  switch (ref.type) {
    case "task":
    case "event":
      return fetchTask(ctx, ref);
    case "doc":
      return fetchDoc(ctx, ref, nextBlock);
    case "project":
      return fetchProject(ctx, ref);
    case "record":
      return fetchRecord(ctx, ref);
    case "template":
      return fetchTemplate(ctx, ref);
    case "proposal":
      return fetchProposal(ctx, ref);
    case "view":
      return fetchView(ctx, ref);
    case "import":
      return fetchImport(ctx, ref);
    default:
      throw new CapabilityError(
        "UNAVAILABLE",
        `Opening a ${ref.type} isn't available to agents yet.`,
        "Fetch tasks, events, pages, projects, records and templates.",
      );
  }
}

export const fetchCapability = defineCapability({
  name: "fetch",
  title: "Open by id",
  description:
    "Open one thing: task:, event:<id>@<occurrence>, doc:<id>#<line>, project:, record:, template:, view: (run: its rows as a table), proposal: or import:, an orbyn:// URI, an Orbyn link, a bare id or an exact title (several matches come back as AMBIGUOUS with candidates). Returns {id, title, text, url, metadata}; pages are Markdown with each line's anchor (^b…), in parts when long (continue with metadata.next_block). Text by others is fenced as untrusted content.",
  input: z
    .object({
      id: z.string().trim().min(1).max(500).describe("What to open."),
      next_block: z
        .string()
        .trim()
        .max(80)
        .optional()
        .describe("Continue a long page from this line (metadata.next_block)."),
    })
    .strict(),
  output,
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  jsonText: true,
  async run(ctx, a) {
    const fetched = await fetchAny(ctx, a.id, a.next_block);
    return {
      structured: fetched,
      markdown: fetched.text,
      targets: [fetched.id],
    };
  },
});

export type { Fetched };
