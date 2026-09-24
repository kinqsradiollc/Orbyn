import { parseProjectDraft } from "../project-draft.js";
import { projectDraftSchema, type ProjectDraft } from "@orbyn/core";
import { z } from "zod";
import {
  blockText,
  estimateModelOf,
  isClosed,
  KINDS,
  parseDoc,
  PRIORITIES,
  STATUSES,
  itemData,
  type Action,
  type DocBlock,
  type DocSource,
  type DraftNote,
  type Plan,
  type SystemRole,
} from "@orbyn/core";
import { makePlan } from "../../planner/plans.js";
import { loadLearning } from "../../planner/learning.js";
import { upNext } from "../../planner/next.js";
import { loadPrefs } from "../../planner/calendar.js";
import { planMarkdown } from "./planText.js";
import { pool } from "../../../db/pool.js";
import { requireTeam, VISIBLE_ITEMS } from "../../../lib/teams.js";
import { mayChange, wantsDeletion } from "../guards.js";
import { localIso } from "../snapshot.js";
import type { JsonSchema, ToolCall, ToolSpec } from "./protocol.js";
import {
  calendarGlance,
  calendarMatches,
  findFreeTime,
  getCalendar,
  getStudy,
  studyGlance,
  followThrough,
  getProject,
  listProjects,
  rankTasks,
} from "./workspace.js";
import { clean, isUuid, localDate, toInstant, whenLabel } from "./format.js";

export { toInstant, whenLabel };

/**
 * The assistant's tools. Reads only ever see the signed-in user's own items
 * and their teams' items (VISIBLE_ITEMS with the session's user id; nothing
 * the model sends can widen it). Proposal tools validate each item and collect
 * changes for the user to approve; nothing is written until they do.
 */
export type AgentContext = {
  user: { id: string; role: SystemRole };
  timezone: string;
  /** The latest request, which decides whether changes and deletions are allowed. */
  intentText: string;
  actions: Action[];
  projectDraft?: ProjectDraft;
  clarification: { question: string; options: string[] } | null;
  /** A schedule planned this turn, for the user to review and apply. */
  plan?: Plan | null;
  /**
   * The pages read while answering, so the reply can point at them. These
   * are what the assistant actually looked at, not what it claims to have
   * used, which is the only version of a citation worth showing.
   */
  cited?: Map<string, DocSource>;
  /** Notes drafted this turn, for the user to keep or discard. */
  notes?: DraftNote[];
};

export const MAX_ACTIONS = 20;
const MAX_RESULT_CHARS = 8000;

type Row = {
  id: string;
  user_id: string;
  title: string;
  notes: string;
  kind: string;
  status: string;
  priority: string;
  due_at: Date | null;
  end_at: Date | null;
  reminder_minutes: number;
  /** Minutes before, from the item's alerts column (ITEM_SELECT is i.*). */
  alerts: number[] | null;
  team_id: string | null;
  team_name: string | null;
  progress: number;
  steps_total: number;
  steps_done: number;
  version: number;
  estimate_minutes?: number | null;
  project_name?: string | null;
};

/** An item as the model sees it: local times, short text, no owner ids. */
function brief(row: Row, timezone: string) {
  return {
    id: row.id,
    title: clean(row.title, 200),
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    when: whenLabel(row.due_at, row.end_at, timezone),
    due_at: localIso(row.due_at, timezone),
    end_at: localIso(row.end_at, timezone),
    team: row.team_name ? clean(row.team_name, 80) : null,
    team_id: row.team_id,
    progress: row.progress,
    ...(row.estimate_minutes ? { estimate_minutes: row.estimate_minutes } : {}),
    ...(row.project_name ? { project: clean(row.project_name, 80) } : {}),
    ...(row.steps_total
      ? { checklist: `${row.steps_done}/${row.steps_total} done` }
      : {}),
  };
}

const ITEM_SELECT =
  "SELECT i.*, t.name AS team_name FROM items i LEFT JOIN teams t ON t.id = i.team_id";

// ---- argument schemas: JSON Schema for the model, zod for the server --------

const draftProperties: Record<string, JsonSchema> = {
  title: { type: "string", description: "Short title." },
  kind: {
    type: "string",
    enum: [...KINDS],
    description: "task, or event (events need a start time).",
  },
  notes: { type: "string" },
  status: { type: "string", enum: [...STATUSES] },
  priority: { type: "string", enum: [...PRIORITIES] },
  due_at: {
    type: "string",
    description:
      "Due or start time, ISO 8601 with the user's UTC offset, e.g. 2026-09-18T18:00:00+10:00.",
  },
  end_at: { type: "string", description: "End time for events, after due_at." },
  reminder_minutes: { type: "integer", minimum: 0, maximum: 10080 },
  team_id: {
    type: "string",
    description:
      'A team id from list_teams to share the item, or "personal". Omit to keep it personal (or unchanged).',
  },
  progress: { type: "integer", minimum: 0, maximum: 100 },
  estimate_minutes: {
    type: "integer",
    minimum: 1,
    maximum: 10080,
    description: "How long the task takes, in minutes (the planner uses it).",
  },
  location: { type: "string", description: "Where an event happens." },
  meeting_url: {
    type: "string",
    description: "A video-call link (https://…).",
  },
  rrule: {
    type: "string",
    description:
      'How it repeats, e.g. "FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE", every weekday "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "FREQ=MONTHLY;COUNT=6". List every day it repeats on in BYDAY. Needs due_at.',
  },
};

const draft = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: z.enum(KINDS).optional(),
    notes: z.string().max(10000).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    due_at: z.string().max(40).nullable().optional(),
    end_at: z.string().max(40).nullable().optional(),
    reminder_minutes: z.number().int().min(0).max(10080).optional(),
    team_id: z.string().max(60).nullable().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    estimate_minutes: z.number().int().min(1).max(10080).nullable().optional(),
    location: z.string().max(300).optional(),
    meeting_url: z.string().max(500).optional(),
    rrule: z.string().max(200).nullable().optional(),
  })
  .strict();
const partialDraft = draft.partial().strict();
type Draft = z.output<typeof partialDraft>;

type Tool = {
  spec: ToolSpec;
  args: z.ZodType;
  run: (ctx: AgentContext, args: never) => Promise<unknown>;
};

const tool = <S extends z.ZodType>(
  spec: ToolSpec,
  args: S,
  run: (ctx: AgentContext, args: z.output<S>) => Promise<unknown>,
): Tool => ({ spec, args, run: run as Tool["run"] });

const NOT_A_CHANGE =
  "The user asked a question, not for a change. Answer it instead of proposing changes.";
const PROPOSED =
  "Proposed only: the user reviews and approves before anything is saved.";

// ---- read tools ---------------------------------------------------------------

/** Counts plus the most pressing items; also the summary in the system prompt. */
export async function overview(ctx: AgentContext) {
  const rows = (
    await pool.query<Row>(
      `${ITEM_SELECT} WHERE ${VISIBLE_ITEMS}
         AND (i.status NOT IN ('done', 'cancelled') OR i.updated_at > now() - interval '7 days')
       ORDER BY (i.due_at IS NULL), i.due_at, i.updated_at DESC LIMIT 500`,
      [ctx.user.id],
    )
  ).rows;
  const today = localDate(new Date(), ctx.timezone);
  const weekOut = localDate(
    new Date(Date.now() + 7 * 86_400_000),
    ctx.timezone,
  );
  const day = (r: Row) => (r.due_at ? localDate(r.due_at, ctx.timezone) : "");
  const open = rows.filter((r) => !isClosed(r.status));
  const overdue = open.filter((r) => r.due_at && day(r) < today);
  const dueToday = open.filter((r) => day(r) === today);
  const upcoming = open.filter((r) => day(r) > today && day(r) <= weekOut);
  const list = (items: Row[], n: number) =>
    items.slice(0, n).map((r) => brief(r, ctx.timezone));
  return {
    today,
    counts: {
      open: open.length,
      in_progress: open.filter((r) => r.status === "in_progress").length,
      blocked: open.filter((r) => r.status === "blocked").length,
      overdue: overdue.length,
      due_today: dueToday.length,
      next_7_days: upcoming.length,
      without_a_date: open.filter((r) => !r.due_at).length,
      done_last_7_days: rows.length - open.length,
    },
    overdue: list(overdue, 5),
    due_today: list(dueToday, 10),
    next_7_days: list(upcoming, 10),
    without_a_date: list(
      open.filter((r) => !r.due_at),
      10,
    ),
    // The top of the app's own order, so even a provider without tools can
    // answer "what should I do first?" from the data it is given.
    suggested_order: (await rankTasks(ctx, { limit: 5 })).tasks.map((t) => ({
      title: t.title,
      when: t.when,
      why: t.why,
    })),
    // The real calendar for today and the next two days: events (repeating
    // ones included), subscribed calendars, time set aside, and free time.
    ...(await calendarGlance(ctx)),
    // Cards due and the next exams, only for people who study in Orbyn.
    ...(await studyGlance(ctx).then((study) => (study ? { study } : {}))),
    note: 'Only some items are listed here; use search_items for the rest and rank_tasks for what to do first. "calendar" is everything on the calendar for today and the next two days, including calendars the user subscribes to (read_only: they can\'t be changed from Orbyn); use get_calendar for other days.',
  };
}

/** The words of a request that could name something (not "move", "today"…). */
export function requestWords(message: string) {
  return [...new Set(message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])]
    .filter((w) => !COMMON_WORDS.has(w))
    .slice(0, 12);
}

/** Words that say what to do or when, not which item. */
const COMMON_WORDS = new Set(
  (
    "the and for with from into that this these those its are was can could would should will you your our " +
    "please add create make new move change update edit set mark delete remove cancel schedule book put push " +
    "shift reschedule rename all both every each today tonight tomorrow next week weekend month monday tuesday " +
    "wednesday thursday friday saturday sunday task tasks event events item items done progress status priority " +
    "high low medium what when where which who how show list tell find due about have has need"
  ).split(" "),
);

/**
 * Items whose titles share words with the request, found by the server before
 * the model's first step, so "move buy groceries to Thursday" can be proposed
 * without a search round trip (fewer steps, and far steadier on providers
 * that are weak at multi-step tool use).
 */
export async function related(ctx: AgentContext, message: string) {
  const words = requestWords(message);
  if (!words.length) return [];
  const rows = (
    await pool.query<Row>(
      `SELECT * FROM (
         SELECT i.*, t.name AS team_name,
           (SELECT count(*) FROM unnest($2::text[]) w
            WHERE lower(i.title) LIKE '%' || w || '%') AS hits
         FROM items i LEFT JOIN teams t ON t.id = i.team_id
         WHERE ${VISIBLE_ITEMS}
           AND (i.status NOT IN ('done', 'cancelled') OR i.updated_at > now() - interval '14 days')
       ) m
       WHERE hits > 0 ORDER BY hits DESC, (due_at IS NULL), due_at LIMIT 12`,
      [ctx.user.id, words],
    )
  ).rows;
  return rows.map((r) => brief(r, ctx.timezone));
}

const searchArgs = z
  .object({
    query: z.string().max(200).optional(),
    status: z.array(z.enum(STATUSES)).max(4).optional(),
    kind: z.enum(KINDS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    team_id: z.string().max(60).optional(),
    due_from: z.string().max(40).optional(),
    due_to: z.string().max(40).optional(),
    include_done: z.boolean().optional(),
    no_due_date: z.boolean().optional(),
    project_id: z.string().max(60).optional(),
    list_id: z.string().max(60).optional(),
    limit: z.number().int().min(1).max(25).optional(),
    offset: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

async function search(ctx: AgentContext, a: z.output<typeof searchArgs>) {
  const where = [VISIBLE_ITEMS];
  const values: unknown[] = [ctx.user.id];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("$?", `$${values.length}`));
  };
  const words = (a.query ?? "").split(/\s+/).filter(Boolean).slice(0, 6);
  for (const word of words)
    add(
      "(i.title || ' ' || i.notes) ILIKE $?",
      `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    );
  if (a.status?.length) add("i.status = ANY($?)", a.status);
  else if (!a.include_done) where.push("i.status NOT IN ('done', 'cancelled')");
  if (a.kind) add("i.kind = $?", a.kind);
  if (a.priority) add("i.priority = $?", a.priority);
  if (a.team_id === "personal") where.push("i.team_id IS NULL");
  else if (a.team_id) {
    if (!isUuid(a.team_id))
      throw new Error(
        'team_id must be a team id from list_teams, or "personal".',
      );
    add("i.team_id = $?", a.team_id);
  }
  if (a.no_due_date) where.push("i.due_at IS NULL");
  for (const [field, value] of [
    ["project_id", a.project_id],
    ["list_id", a.list_id],
  ] as const) {
    if (!value) continue;
    if (!isUuid(value))
      throw new Error(
        `${field} must be an id from list_projects or search_items.`,
      );
    add(`i.${field} = $?`, value);
  }
  for (const [value, op, end] of [
    [a.due_from, ">=", false],
    [a.due_to, "<=", true],
  ] as const) {
    if (!value) continue;
    const at = toInstant(value, ctx.timezone, end);
    if (Number.isNaN(Date.parse(at)))
      throw new Error(`"${value}" is not a date; use YYYY-MM-DD.`);
    add(`i.due_at ${op} $?`, at);
  }
  const limit = a.limit ?? 15;
  values.push(limit, a.offset ?? 0);
  const rows = (
    await pool.query<Row & { total: number }>(
      `SELECT i.*, t.name AS team_name, p.name AS project_name,
              count(*) OVER()::int AS total
       FROM items i LEFT JOIN teams t ON t.id = i.team_id
         LEFT JOIN projects p ON p.id = i.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY (i.due_at IS NULL), i.due_at, i.updated_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    )
  ).rows;
  const total = rows[0]?.total ?? 0;
  return {
    total,
    items: rows.map((r) => brief(r, ctx.timezone)),
    more: total > (a.offset ?? 0) + rows.length,
  };
}

/** An item this user can see, or null (other people's ids look like missing ones). */
async function visibleItem(ctx: AgentContext, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  return (
    (
      await pool.query<Row>(
        `${ITEM_SELECT} WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
        [ctx.user.id, id],
      )
    ).rows[0] ?? null
  );
}

const NO_SUCH_ITEM =
  "No item with that id in this planner. Use an id from search_items.";

async function getItem(ctx: AgentContext, a: { id: string }) {
  const row = await visibleItem(ctx, a.id);
  if (!row) throw new Error(NO_SUCH_ITEM);
  const [steps, updates] = await Promise.all([
    pool.query<{ title: string; done: boolean }>(
      "SELECT title, done FROM item_steps WHERE item_id = $1 ORDER BY position, created_at LIMIT 30",
      [row.id],
    ),
    pool.query<{
      author: string;
      body: string;
      status: string | null;
      progress: number | null;
      created_at: Date;
    }>(
      `SELECT coalesce(a.name, 'Former member') AS author, u.body, u.status, u.progress, u.created_at
       FROM item_updates u LEFT JOIN users a ON a.id = u.user_id
       WHERE u.item_id = $1 ORDER BY u.created_at DESC LIMIT 5`,
      [row.id],
    ),
  ]);
  return {
    ...brief(row, ctx.timezone),
    notes: clean(row.notes, 2000),
    reminder_minutes: row.reminder_minutes,
    checklist: steps.rows.map((s) => ({
      title: clean(s.title, 200),
      done: s.done,
    })),
    recent_updates: updates.rows.map((u) => ({
      author: clean(u.author, 80),
      note: clean(u.body, 300),
      status: u.status,
      progress: u.progress,
      at: localIso(u.created_at, ctx.timezone),
    })),
  };
}

async function listTeams(ctx: AgentContext) {
  const rows = (
    await pool.query<{ id: string; name: string; role: string }>(
      `SELECT t.id, t.name, m.role FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE m.user_id = $1 ORDER BY t.name`,
      [ctx.user.id],
    )
  ).rows;
  return {
    teams: rows.map((t) => ({
      id: t.id,
      name: clean(t.name, 80),
      role: t.role,
      can_add_items: t.role !== "viewer",
    })),
  };
}

// ---- proposal tools -------------------------------------------------------------

/** Model times as instants, and "personal" as no team. */
function normalize(d: Draft, timezone: string): Draft {
  const out = { ...d };
  if (typeof out.due_at === "string")
    out.due_at = toInstant(out.due_at, timezone);
  if (typeof out.end_at === "string")
    out.end_at = toInstant(out.end_at, timezone);
  if (out.team_id === "personal" || out.team_id === "") out.team_id = null;
  // A repeating item keeps its wall-clock time in the user's time zone.
  if (out.rrule) (out as Draft & { timezone?: string }).timezone = timezone;
  return out;
}

const problem = (error: unknown) =>
  error instanceof z.ZodError
    ? error.issues
        .map((i) =>
          i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
        )
        .join("; ")
    : error instanceof Error
      ? error.message
      : "Invalid item.";

async function canWriteTeam(ctx: AgentContext, teamId: string) {
  try {
    await requireTeam(teamId, ctx.user, "items:write");
    return true;
  } catch {
    return false;
  }
}

const full = (ctx: AgentContext) => ctx.actions.length >= MAX_ACTIONS;
const TOO_MANY = `At most ${MAX_ACTIONS} changes fit in one reply; tell the user to ask for the rest next.`;

async function proposeCreate(ctx: AgentContext, a: { items: Draft[] }) {
  if (!mayChange(ctx.intentText)) throw new Error(NOT_A_CHANGE);
  const results = [];
  for (const [index, d] of a.items.entries()) {
    try {
      const data = itemData.parse(normalize(d, ctx.timezone));
      if (data.team_id && !(await canWriteTeam(ctx, data.team_id)))
        throw new Error(
          "You can't add items to that team (not a member, or a viewer). Use list_teams.",
        );
      const same = (x: Action) =>
        x.operation === "create" &&
        x.data!.title.toLowerCase() === data.title.toLowerCase() &&
        x.data!.kind === data.kind &&
        x.data!.due_at === data.due_at;
      // Proposing the same item again in one reply is a correction (a
      // different repeat, a fixed time): it replaces the earlier draft.
      const earlier = ctx.actions.findIndex(same);
      if (earlier >= 0) {
        ctx.actions[earlier] = { operation: "create", data };
        results.push({
          index,
          ok: true,
          replaced_earlier_draft: true,
          title: data.title,
          due_at: localIso(data.due_at, ctx.timezone),
        });
        continue;
      }
      if (full(ctx)) throw new Error(TOO_MANY);
      const existing = (
        await pool.query<{ id: string }>(
          `SELECT i.id FROM items i WHERE ${VISIBLE_ITEMS} AND lower(i.title) = lower($2)
             AND i.kind = $3 AND i.due_at IS NOT DISTINCT FROM $4::timestamptz LIMIT 1`,
          [ctx.user.id, data.title, data.kind, data.due_at],
        )
      ).rows[0];
      if (existing)
        throw new Error(
          `This item already exists (id ${existing.id}); update it instead of adding a copy.`,
        );
      ctx.actions.push({ operation: "create", data });
      results.push({
        index,
        ok: true,
        title: data.title,
        due_at: localIso(data.due_at, ctx.timezone),
      });
    } catch (error) {
      results.push({ index, ok: false, error: problem(error) });
    }
  }
  return { results, note: PROPOSED };
}

/** The saved item as item data, the base an update is merged onto. */
const savedData = (row: Row) =>
  itemData.parse({
    title: row.title,
    notes: row.notes,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    due_at: row.due_at ? row.due_at.toISOString() : null,
    end_at: row.end_at ? row.end_at.toISOString() : null,
    alerts: row.alerts ?? [],
    team_id: row.team_id,
  });

/** An item this user may change, or an error the model can act on. */
async function writable(ctx: AgentContext, id: string) {
  const row = await visibleItem(ctx, id);
  if (!row) throw new Error(NO_SUCH_ITEM);
  if (row.team_id && !(await canWriteTeam(ctx, row.team_id)))
    throw new Error("You can only view this team item, not change it.");
  return row;
}

const sameTime = (a: string | null, b: string | null) =>
  (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);

const ALL_OF_THEM = /\b(all|both|every|each)\b/i;
const SAME_TITLE =
  "Several items with this title were picked, but the user named one. Ask which one they mean with ask_clarification (list the days and times), unless they asked for all of them.";

/**
 * Ids that share a title with another item picked for the same operation
 * (in this call or earlier in the turn) when the user named a single item:
 * "cancel the gym session" with two gym sessions must be a question, not two
 * deletions. "Both", "all", "every", "each" or the plural title allow it.
 */
async function sameTitleIds(
  ctx: AgentContext,
  operation: "update" | "delete",
  ids: string[],
) {
  if (ALL_OF_THEM.test(ctx.intentText)) return new Set<string>();
  const picked = [
    ...new Set([
      ...ids.filter(isUuid),
      ...ctx.actions.flatMap((x) =>
        x.operation === operation && x.item_id ? [x.item_id] : [],
      ),
    ]),
  ];
  if (picked.length < 2) return new Set<string>();
  const rows = (
    await pool.query<{ id: string; title: string }>(
      `SELECT i.id, lower(trim(i.title)) AS title FROM items i
       WHERE ${VISIBLE_ITEMS} AND i.id = ANY($2::uuid[])`,
      [ctx.user.id, picked],
    )
  ).rows;
  const said = ctx.intentText.toLowerCase();
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.title, (count.get(r.title) ?? 0) + 1);
  return new Set(
    rows
      .filter(
        (r) =>
          count.get(r.title)! > 1 &&
          !said.includes(`${r.title}s`) &&
          ids.includes(r.id),
      )
      .map((r) => r.id),
  );
}

async function proposeUpdate(
  ctx: AgentContext,
  a: { changes: { id: string; fields: Draft }[] },
) {
  if (!mayChange(ctx.intentText)) throw new Error(NOT_A_CHANGE);
  const results = [];
  const clash = await sameTitleIds(
    ctx,
    "update",
    a.changes.map((c) => c.id),
  );
  for (const [index, change] of a.changes.entries()) {
    try {
      if (clash.has(change.id)) throw new Error(SAME_TITLE);
      const row = await writable(ctx, change.id);
      if (
        ctx.actions.some(
          (x) => x.operation === "delete" && x.item_id === row.id,
        )
      )
        throw new Error("This item is already proposed for deletion.");
      const pending = ctx.actions.find(
        (x) => x.operation === "update" && x.item_id === row.id,
      );
      if (!pending && full(ctx)) throw new Error(TOO_MANY);
      const fields = normalize(change.fields, ctx.timezone);
      if (fields.progress !== undefined && row.steps_total > 0)
        throw new Error(
          "This task's progress follows its checklist, so it can't be set directly.",
        );
      // Only the fields sent change; the rest keep their saved (or already
      // proposed) values, so two calls for one item combine.
      const saved = savedData(row);
      const data = itemData.parse({ ...(pending?.data ?? saved), ...fields });
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter(
        (key) =>
          key === "due_at" || key === "end_at"
            ? !sameTime(data[key], saved[key])
            : key === "progress"
              ? data.progress !== undefined && data.progress !== row.progress
              : data[key] !== saved[key],
      );
      if (!changed.length) throw new Error("That would not change anything.");
      if (
        data.team_id !== row.team_id &&
        data.team_id &&
        !(await canWriteTeam(ctx, data.team_id))
      )
        throw new Error("You can't move items into that team.");
      if (pending) pending.data = data;
      else
        ctx.actions.push({
          operation: "update",
          item_id: row.id,
          version: row.version,
          data,
        });
      results.push({ index, ok: true, id: row.id, title: data.title, changed });
    } catch (error) {
      results.push({ index, ok: false, id: change.id, error: problem(error) });
    }
  }
  return { results, note: PROPOSED };
}

async function proposeDelete(ctx: AgentContext, a: { ids: string[] }) {
  if (!wantsDeletion(ctx.intentText))
    throw new Error(
      "The user didn't ask to delete, remove or cancel anything, so don't propose deletions.",
    );
  const results = [];
  const clash = await sameTitleIds(ctx, "delete", a.ids);
  for (const id of a.ids) {
    try {
      if (clash.has(id)) throw new Error(SAME_TITLE);
      const row = await writable(ctx, id);
      if (
        ctx.actions.some(
          (x) => x.operation === "delete" && x.item_id === row.id,
        )
      )
        throw new Error("Already proposed in this reply.");
      // A deletion replaces a pending edit of the same item.
      const rest = ctx.actions.filter((x) => x.item_id !== row.id);
      if (rest.length >= MAX_ACTIONS) throw new Error(TOO_MANY);
      ctx.actions = [
        ...rest,
        { operation: "delete", item_id: row.id, version: row.version },
      ];
      results.push({ id, ok: true, title: clean(row.title, 200) });
    } catch (error) {
      results.push({ id, ok: false, error: problem(error) });
    }
  }
  return { results, note: PROPOSED };
}

async function askClarification(
  ctx: AgentContext,
  a: { question: string; options?: string[] },
) {
  const asked = [a.question, ...(a.options ?? [])].join(" ");
  if (
    /\b(get[ _]overview|search[ _]items|get[ _]item|list[ _]teams|propose_\w+|ask_clarification|tools?)\b/i.test(
      asked,
    )
  )
    throw new Error(
      "Ask the user about their request, never about tools. Use the tools yourself.",
    );
  if (
    /\b(which|what) (date|day) is\b|\bdate (is|for) ['"]?(today|tomorrow|next)/i.test(
      asked,
    )
  )
    throw new Error(
      "Don't ask for dates you can work out: the system message lists today and the coming days.",
    );
  ctx.clarification = {
    question: a.question.trim(),
    options: (a.options ?? [])
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 4),
  };
  return {
    ok: true,
    note: "The question is shown to the user; the turn ends here.",
  };
}

// ---- the tool table ---------------------------------------------------------------

/**
 * Plan the user's time with the planner engine. The assistant only chooses
 * the inputs; the engine places every block. Nothing is saved until the user
 * applies the plan in the app.
 */
async function planSchedule(
  ctx: AgentContext,
  a: {
    start_date?: string;
    days?: number;
    keep_free?: { start_at: string; end_at: string }[];
    item_ids?: string[];
  },
) {
  const keepFree = (a.keep_free ?? []).map((k) => ({
    start_at: toInstant(k.start_at, ctx.timezone),
    end_at: toInstant(k.end_at, ctx.timezone, true),
  }));
  if (
    keepFree.some(
      (k) =>
        Number.isNaN(Date.parse(k.start_at)) ||
        Number.isNaN(Date.parse(k.end_at)),
    )
  )
    throw new Error("keep_free times must be dates or date-times.");
  const plan = await makePlan(pool, ctx.user.id, {
    start_date: a.start_date,
    days: a.days,
    use_frames: true,
    keep_free: keepFree,
    item_ids: a.item_ids ? a.item_ids.filter(isUuid) : undefined,
    exclude_item_ids: [],
    timezone: ctx.timezone,
  });
  ctx.plan = plan;
  return {
    summary: plan.summary,
    blocks: plan.blocks.slice(0, 40).map((b) => ({
      title: clean(b.title, 200),
      when: whenLabel(new Date(b.start_at), new Date(b.end_at), ctx.timezone),
      ...(b.parts > 1 ? { session: `${b.part} of ${b.parts}` } : {}),
    })),
    unplaced: plan.unplaced.map((u) => ({
      title: clean(u.title, 200),
      reason: u.reason,
    })),
    at_risk: plan.at_risk.map((u) => ({
      title: clean(u.title, 200),
      reason: u.reason,
    })),
    note: "Proposed only: the user reviews this plan and applies it to add the sessions to their calendar.",
    as_markdown: planMarkdown(plan, ctx.timezone),
  };
}

const NO_ARGS: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const TOOLS: Tool[] = [
  tool(
    {
      name: "propose_project",
      description:
        "Break a project into concrete subtasks with estimated minutes and dependency ids. Orbyn schedules these into available frames. Use for requests to break down or draft a project. Do not combine with other proposals or plan_schedule in this turn. The user reviews the entire graph and schedule before approval.",
      parameters: z.toJSONSchema(projectDraftSchema) as JsonSchema,
    },
    projectDraftSchema,
    async (ctx, draft) => {
      if (!mayChange(ctx.intentText))
        throw new Error("The user must ask to draft or decompose a project.");
      if (ctx.actions.length || ctx.plan || ctx.projectDraft)
        throw new Error(
          "Review one project at a time; do not mix it with other changes.",
        );
      ctx.projectDraft = parseProjectDraft(JSON.stringify(draft));
      return {
        title: draft.title,
        tasks: draft.tasks,
        review_required: true,
        message:
          "The project and a schedule will be shown for approval. Nothing has been created yet.",
      };
    },
  ),
  tool(
    {
      name: "search_docs",
      description:
        "Search the pages and notes this person can read — documents, meeting notes, agendas, project notes. Use this before answering anything about what was written down, decided or agreed. Returns ids and the line that matched, for citing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "What to look for, in ordinary words.",
          },
          kind: {
            type: "string",
            enum: ["doc", "note", "agenda", "meeting"],
            description: "Narrow to one kind of page.",
          },
          limit: { type: "number", description: "At most 10; 5 by default." },
        },
      },
    },
    z
      .object({
        query: z.string().trim().min(1).max(200),
        kind: z.enum(["doc", "note", "agenda", "meeting"]).optional(),
        limit: z.number().int().min(1).max(10).default(5),
      })
      .strict(),
    (ctx, a) => searchDocs(ctx, a),
  ),
  tool(
    {
      name: "get_doc",
      description:
        "Read one page in full, line by line, with the block ids to cite lines by. Use after search_docs when the snippet is not enough.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["doc_id"],
        properties: {
          doc_id: { type: "string", description: "An id from search_docs." },
        },
      },
    },
    z.object({ doc_id: z.uuid() }).strict(),
    (ctx, a) => readDoc(ctx, a),
  ),
  tool(
    {
      name: "propose_note",
      description:
        "Draft a note for the user to keep. Use when they ask you to write something up, summarise a meeting, or capture decisions. The draft is shown to them and saved only if they keep it — never say it is saved.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string", description: "A short, plain title." },
          body: {
            type: "string",
            description:
              "The note in Markdown: # headings, - bullets, - [ ] checklist lines, > quotes.",
          },
          project_id: {
            type: "string",
            description:
              "A project id from search_docs or get_overview to hang it off.",
          },
          item_id: {
            type: "string",
            description:
              "A task id from search_items, for a note about one task.",
          },
          why: {
            type: "string",
            description: "One line on why it is worth keeping.",
          },
        },
      },
    },
    z
      .object({
        title: z.string().trim().min(1).max(200),
        body: z.string().max(20_000),
        project_id: z.uuid().optional(),
        item_id: z.uuid().optional(),
        why: z.string().trim().max(300).optional(),
      })
      .strict(),
    (ctx, a) => draftNote(ctx, a),
  ),
  tool(
    {
      name: "propose_doc_edit",
      description:
        "Propose changes to words on an existing page. They appear beside the page for the user to take or leave, exactly like a colleague's suggestions. Quote the words to change exactly as get_doc returned them.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["doc_id", "changes"],
        properties: {
          doc_id: { type: "string", description: "An id from search_docs." },
          changes: {
            type: "array",
            description: "At most 10 changes.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["find", "replace"],
              properties: {
                find: {
                  type: "string",
                  description: "The exact words on the page to change.",
                },
                replace: {
                  type: "string",
                  description:
                    "What they should say instead. Empty removes them.",
                },
              },
            },
          },
          why: { type: "string", description: "One line on why." },
        },
      },
    },
    z
      .object({
        doc_id: z.uuid(),
        changes: z
          .array(
            z
              .object({
                find: z.string().min(1).max(2000),
                replace: z.string().max(2000),
              })
              .strict(),
          )
          .min(1)
          .max(10),
        why: z.string().trim().max(300).optional(),
      })
      .strict(),
    (ctx, a) => proposeDocEdit(ctx, a),
  ),
  tool(
    {
      name: "get_overview",
      description:
        "Counts plus overdue, today's and the next 7 days' items. Use for summaries and 'what needs my attention'.",
      parameters: NO_ARGS,
    },
    z.object({}).strict(),
    (ctx) => overview(ctx),
  ),
  tool(
    {
      name: "search_items",
      description:
        "Find items by words, status, type, priority, team, project, list or due-date range — or with no due date — with the ids needed for changes. Leaves out done items unless include_done or status asks for them.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Words that must all appear in the title or notes.",
          },
          status: {
            type: "array",
            items: { type: "string", enum: [...STATUSES] },
          },
          kind: { type: "string", enum: [...KINDS] },
          priority: { type: "string", enum: [...PRIORITIES] },
          team_id: {
            type: "string",
            description: 'A team id from list_teams, or "personal".',
          },
          due_from: {
            type: "string",
            description: "YYYY-MM-DD (local) or a date-time: due on or after.",
          },
          due_to: {
            type: "string",
            description:
              "YYYY-MM-DD (the end of that local day) or a date-time: due on or before.",
          },
          include_done: { type: "boolean" },
          no_due_date: {
            type: "boolean",
            description: "Only items without a due date.",
          },
          project_id: {
            type: "string",
            description: "A project id from list_projects.",
          },
          list_id: { type: "string", description: "A list id." },
          limit: { type: "integer", minimum: 1, maximum: 25 },
          offset: { type: "integer", minimum: 0 },
        },
      },
    },
    searchArgs,
    search,
  ),
  tool(
    {
      name: "get_item",
      description:
        "One item in full: notes, checklist and recent progress updates.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    z.object({ id: z.string().max(60) }).strict(),
    getItem,
  ),
  tool(
    {
      name: "rank_tasks",
      description:
        "Open tasks in the order to do them, by the app's own priority score, each with the reasons (overdue, due soon, high priority, started, blocked, no date, no estimate). Use for 'what should I do first', 'help me prioritise', or which undated tasks matter. Read only.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 25 },
          team_id: {
            type: "string",
            description: 'A team id from list_teams, or "personal".',
          },
          only_undated: {
            type: "boolean",
            description: "Only tasks without a due date.",
          },
        },
      },
    },
    z
      .object({
        limit: z.number().int().min(1).max(25).optional(),
        team_id: z.string().max(60).optional(),
        only_undated: z.boolean().optional(),
      })
      .strict(),
    rankTasks,
  ),
  tool(
    {
      name: "up_next",
      description:
        "What to do right now: the free time until the user's next event (or the end of their working day) and up to three tasks worth starting in it, each with the reasons (planned for now, due soon, fits the free time, an hour that usually goes well for them, keeps slipping) and a sensible session length. Use for 'what should I do now', 'I have 30 minutes', 'what next'. Read only.",
      parameters: NO_ARGS,
    },
    z.object({}).strict(),
    async (ctx) => {
      const next = await upNext(pool, ctx.user.id);
      return {
        free_time: next.window && {
          from: localIso(next.window.start_at, ctx.timezone),
          until: localIso(next.window.end_at, ctx.timezone),
          minutes: next.window.minutes,
          next_event: next.window.until,
        },
        suggestions: next.suggestions.map((s) => ({
          title: s.title,
          due: s.due_at ? localIso(s.due_at, ctx.timezone) : null,
          priority: s.priority,
          session_minutes: s.minutes,
          planned_now: s.planned_now,
          reasons: s.reasons,
        })),
        note: next.window
          ? undefined
          : "No free time right now (an event is on, or it's outside working hours); the tasks are still the ones to do next.",
      };
    },
  ),
  tool(
    {
      name: "get_work_patterns",
      description:
        "What the planner has learned from the user's own history: how long their tasks really take against their estimates (overall, by tag and by list), which hours of the day usually go well for them, and how much planned time they usually get through in a day. Use for 'when am I most productive', 'how long do my tasks really take', 'am I planning too much'. Read only; say plainly when there isn't enough history yet.",
      parameters: NO_ARGS,
    },
    z.object({}).strict(),
    async (ctx) => {
      const prefs = await loadPrefs(pool, ctx.user.id);
      const l = await loadLearning(pool, ctx.user.id, prefs.timezone);
      const e = estimateModelOf(l.durations, !!prefs.learn_estimates);
      const clock = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
      return {
        durations:
          e.overall.samples >= 3
            ? {
                ratio: e.overall.ratio,
                usual_range: e.overall.range,
                from_tasks: e.overall.samples,
                by_tag: e.tags
                  .slice(0, 5)
                  .map((t) => ({ tag: t.name, ratio: t.ratio })),
                by_list: (e.lists ?? [])
                  .slice(0, 5)
                  .map((t) => ({ list: t.name, ratio: t.ratio })),
                typical_task_minutes: e.typical_minutes,
                applied_by_planner: e.applied,
              }
            : "Not enough finished tasks with an estimate and logged time yet.",
        best_hours: l.rhythm.peak
          ? `${clock(l.rhythm.peak.start_hour)}–${clock(l.rhythm.peak.end_hour)}`
          : "Not enough sessions or focus time yet.",
        hours_that_slip: l.rhythm.confidence
          ? l.rhythm.hours
              .map((v, h) => ({ v, h }))
              .filter((x) => x.v <= -0.5)
              .map((x) => clock(x.h))
          : [],
        typical_day:
          l.load.typical_day_minutes == null
            ? "Not enough planned days yet."
            : {
                minutes: l.load.typical_day_minutes,
                share_of_planned_time_done: l.load.follow_through,
                from_days: l.load.days,
              },
        planner_uses_best_hours: prefs.learn_rhythm !== false,
        planner_balances_days: prefs.balance_load !== false,
      };
    },
  ),
  tool(
    {
      name: "list_projects",
      description:
        "The user's projects with progress, deadline and whether each is at risk. Read only.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { include_archived: { type: "boolean" } },
      },
    },
    z.object({ include_archived: z.boolean().optional() }).strict(),
    listProjects,
  ),
  tool(
    {
      name: "get_project",
      description:
        "One project in full: open tasks by stage, its notes, and open decisions and promises (flagging decisions no task delivers). Read only.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["project_id"],
        properties: {
          project_id: {
            type: "string",
            description: "An id from list_projects.",
          },
        },
      },
    },
    z.object({ project_id: z.string().max(60) }).strict(),
    getProject,
  ),
  tool(
    {
      name: "find_free_time",
      description:
        "Free stretches in the user's working hours over the coming days, around events and sessions. Use for 'when am I free', 'do I have time for X'. Read only; to place tasks use plan_schedule.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          start_date: {
            type: "string",
            description:
              "YYYY-MM-DD in the user's time zone; now when omitted.",
          },
          days: { type: "integer", minimum: 1, maximum: 14 },
          min_minutes: {
            type: "integer",
            minimum: 5,
            maximum: 480,
            description: "Shortest stretch worth listing; 30 by default.",
          },
        },
      },
    },
    z
      .object({
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
          .optional(),
        days: z.number().int().min(1).max(14).optional(),
        min_minutes: z.number().int().min(5).max(480).optional(),
      })
      .strict(),
    findFreeTime,
  ),
  tool(
    {
      name: "get_calendar",
      description:
        "What's on the user's calendar: their own events and the calendars they subscribe to (class timetables, exams, work shifts, meetings, holidays), with titles, times and places. Use for 'what's on today/Thursday', 'when is my next class', before planning a day. Subscribed events are read only. Read only.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          start_date: {
            type: "string",
            description:
              "YYYY-MM-DD in the user's time zone; today when omitted.",
          },
          days: { type: "integer", minimum: 1, maximum: 14 },
        },
      },
    },
    z
      .object({
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
          .optional(),
        days: z.number().int().min(1).max(14).optional(),
      })
      .strict(),
    getCalendar,
  ),
  tool(
    {
      name: "get_study",
      description:
        "The user's studying: pages with flashcards (cards due, new, known well), upcoming exams with the pages attached and how ready they are, and the cards forgotten most. Use for 'what should I revise', 'am I ready for my exam', 'how is my studying going'. Read only: cards are written in pages as 'Question :: Answer' lines, and revision is planned in Study.",
      parameters: NO_ARGS,
    },
    z.object({}).strict(),
    getStudy,
  ),
  tool(
    {
      name: "get_follow_through",
      description:
        "What is waiting on people: tasks asked of the user or by them, open promises, decisions no task delivers, and how well plans have held lately. Use for 'what am I waiting on', 'what do I owe people', weekly reviews. Read only.",
      parameters: NO_ARGS,
    },
    z.object({}).strict(),
    (ctx) => followThrough(ctx),
  ),
  tool(
    {
      name: "list_teams",
      description:
        "The user's teams, their role in each, and whether they can add items there.",
      parameters: NO_ARGS,
    },
    z.object({}).strict(),
    (ctx) => listTeams(ctx),
  ),
  tool(
    {
      name: "propose_create",
      description:
        "Propose new items; put every item the user asked for in one call. The user approves before anything is saved.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ACTIONS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: draftProperties,
            },
          },
        },
      },
    },
    z.object({ items: z.array(draft).min(1).max(MAX_ACTIONS) }).strict(),
    proposeCreate,
  ),
  tool(
    {
      name: "propose_update",
      description:
        "Propose changes to existing items by id, sending only the fields that change. Several items per call. The user approves before anything is saved.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["changes"],
        properties: {
          changes: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ACTIONS,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "fields"],
              properties: {
                id: { type: "string" },
                fields: {
                  type: "object",
                  additionalProperties: false,
                  properties: draftProperties,
                },
              },
            },
          },
        },
      },
    },
    z
      .object({
        changes: z
          .array(
            z.object({ id: z.string().max(60), fields: partialDraft }).strict(),
          )
          .min(1)
          .max(MAX_ACTIONS),
      })
      .strict(),
    proposeUpdate,
  ),
  tool(
    {
      name: "propose_delete",
      description:
        "Propose deleting items by id. Only when the user asked to delete, remove or cancel them.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ids"],
        properties: {
          ids: {
            type: "array",
            minItems: 1,
            maxItems: MAX_ACTIONS,
            items: { type: "string" },
          },
          reason: { type: "string" },
        },
      },
    },
    z
      .object({
        ids: z.array(z.string().max(60)).min(1).max(MAX_ACTIONS),
        reason: z.string().max(300).optional(),
      })
      .strict(),
    proposeDelete,
  ),
  tool(
    {
      name: "ask_clarification",
      description:
        "Ask the user ONE short question when you can't tell what they mean, for example when several items match. Offer 2-4 short options when you can. Ends your turn.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: {
          question: { type: "string" },
          options: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    },
    z
      .object({
        question: z.string().trim().min(1).max(500),
        options: z.array(z.string().max(120)).max(4).optional(),
      })
      .strict(),
    askClarification,
  ),
  tool(
    {
      name: "plan_schedule",
      description:
        "Plan the user's time: place their open tasks into free working time for 1-7 days, around events, frames, estimates and due dates. Returns a proposed plan the user reviews and applies; nothing is saved until then. Use for 'plan my day', 'plan my week', 'when should I work on X'.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          start_date: {
            type: "string",
            description:
              "First day, YYYY-MM-DD in the user's time zone; today when omitted.",
          },
          days: { type: "integer", minimum: 1, maximum: 7 },
          keep_free: {
            type: "array",
            maxItems: 20,
            description: 'Times to leave empty ("keep Friday afternoon free").',
            items: {
              type: "object",
              additionalProperties: false,
              required: ["start_at", "end_at"],
              properties: {
                start_at: { type: "string" },
                end_at: { type: "string" },
              },
            },
          },
          item_ids: {
            type: "array",
            maxItems: 200,
            items: { type: "string" },
            description: "Only plan these tasks (ids from search_items).",
          },
        },
      },
    },
    z
      .object({
        start_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
          .optional(),
        days: z.number().int().min(1).max(7).optional(),
        keep_free: z
          .array(
            z
              .object({
                start_at: z.string().max(40),
                end_at: z.string().max(40),
              })
              .strict(),
          )
          .max(20)
          .optional(),
        item_ids: z.array(z.string().max(60)).max(200).optional(),
      })
      .strict(),
    planSchedule,
  ),
];

export const TOOL_SPECS = TOOLS.map((t) => t.spec);

const errorResult = (message: string) => ({
  content: JSON.stringify({ error: message }),
  isError: true,
});

/** Run one tool call. Every failure comes back as a result the model can act on. */
/**
 * What a document search hands back. Enough to name it and cite it, never
 * the whole page — a page is fetched on purpose with get_doc.
 */
async function searchDocs(
  ctx: AgentContext,
  a: { query: string; kind?: string; limit: number },
) {
  const rows = (
    await pool.query<{
      id: string;
      title: string;
      kind: string;
      project_name: string | null;
      updated_at: string;
      snippet: string;
      block_id: string | null;
    }>(
      `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq)
       SELECT d.id, d.title, d.kind, p.name AS project_name, d.updated_at,
              ts_headline('english', doc_words(d.content, NULL), q.tsq,
                          'StartSel=, StopSel=, MaxWords=30, MinWords=12, MaxFragments=1')
                AS snippet,
              (SELECT b->>'id' FROM jsonb_array_elements(d.content) b
                WHERE b->>'text' IS NOT NULL AND b->>'id' IS NOT NULL
                  AND to_tsvector('english', b->>'text') @@ q.tsq LIMIT 1) AS block_id
         FROM docs d
         LEFT JOIN projects p ON p.id = d.project_id
         CROSS JOIN q
        WHERE ((d.team_id IS NULL AND d.user_id = $1)
               OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
          AND (d.search @@ q.tsq OR similarity(d.title, $2) > 0.25)
          AND ($3::text IS NULL OR d.kind = $3)
        ORDER BY ts_rank_cd(d.search, q.tsq) DESC, d.updated_at DESC
        LIMIT $4`,
      [ctx.user.id, a.query, a.kind ?? null, a.limit],
    )
  ).rows;
  for (const row of rows)
    ctx.cited?.set(row.id, {
      doc_id: row.id,
      title: row.title,
      block_id: row.block_id,
      quote: (row.snippet || "").slice(0, 300),
    });
  return {
    items: rows,
    note: rows.length
      ? "Cite a page with its id and the block_id that matched."
      : "Nothing written down matches. Say so rather than answering from memory.",
  };
}

/** One page as plain text, line by line, with the names to cite lines by. */
async function readDoc(ctx: AgentContext, a: { doc_id: string }) {
  const doc = (
    await pool.query<{
      id: string;
      title: string;
      kind: string;
      content: { id?: string; type: string; text?: string }[];
      updated_at: string;
    }>(
      `SELECT d.id, d.title, d.kind, d.content, d.updated_at FROM docs d
        WHERE d.id = $2
          AND ((d.team_id IS NULL AND d.user_id = $1)
               OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`,
      [ctx.user.id, a.doc_id],
    )
  ).rows[0];
  if (!doc) throw new Error("No such page, or it is not yours to read.");
  ctx.cited?.set(doc.id, {
    doc_id: doc.id,
    title: doc.title,
    block_id: null,
    quote: (doc.content.find((b) => (b.text ?? "").trim())?.text ?? "").slice(
      0,
      300,
    ),
  });
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    updated_at: doc.updated_at,
    lines: doc.content
      .filter((b) => (b.text ?? "").trim())
      .map((b) => ({ block_id: b.id ?? null, text: b.text })),
  };
}

/**
 * Draft a note. Nothing is written: the draft travels back with the reply
 * and becomes a page only if someone keeps it.
 */
async function draftNote(
  ctx: AgentContext,
  a: {
    title: string;
    body: string;
    project_id?: string;
    item_id?: string;
    why?: string;
  },
) {
  if (!ctx.notes) throw new Error("Notes cannot be drafted here.");
  if (ctx.notes.length >= 3)
    throw new Error("That is enough notes for one turn.");
  // A project or task named here has to be one this person can actually
  // see; the model is not trusted with an id it invented.
  let project: { id: string; name: string; team_id: string | null } | null =
    null;
  if (a.project_id)
    project =
      (
        await pool.query<{ id: string; name: string; team_id: string | null }>(
          `SELECT p.id, p.name, p.team_id FROM projects p
            WHERE p.id = $2
              AND ((p.team_id IS NULL AND p.user_id = $1)
                   OR p.team_id IN (SELECT team_id FROM team_members
                                     WHERE user_id = $1))`,
          [ctx.user.id, a.project_id],
        )
      ).rows[0] ?? null;
  let item: { id: string; team_id: string | null } | null = null;
  if (a.item_id)
    item =
      (
        await pool.query<{ id: string; team_id: string | null }>(
          `SELECT i.id, i.team_id FROM items i WHERE i.id = $2 AND ${VISIBLE_ITEMS}`,
          [ctx.user.id, a.item_id],
        )
      ).rows[0] ?? null;

  const content = parseDoc(a.body);
  const draft: DraftNote = {
    title: a.title.slice(0, 200),
    content: content.length ? content : [{ type: "paragraph", text: "" }],
    project_id: project?.id ?? null,
    project_name: project?.name ?? null,
    item_id: item?.id ?? null,
    team_id: project?.team_id ?? item?.team_id ?? null,
    note: (a.why ?? "").slice(0, 300),
  };
  ctx.notes.push(draft);
  return {
    drafted: draft.title,
    lines: draft.content.length,
    project: draft.project_name,
    note: "The draft is shown to the user, who decides whether to keep it. Say what you drafted; never say it is saved.",
  };
}

/**
 * Propose changes to a page. These go where a colleague's proposals go —
 * beside the words, with the same Take or Leave — rather than into the
 * reply, because a change to a sentence is read next to that sentence.
 */
async function proposeDocEdit(
  ctx: AgentContext,
  a: {
    doc_id: string;
    changes: { find: string; replace: string }[];
    why?: string;
  },
) {
  const doc = (
    await pool.query<{ id: string; content: DocBlock[]; title: string }>(
      `SELECT d.id, d.content, d.title FROM docs d
        WHERE d.id = $2
          AND ((d.team_id IS NULL AND d.user_id = $1)
               OR d.team_id IN (SELECT team_id FROM team_members
                                 WHERE user_id = $1))`,
      [ctx.user.id, a.doc_id],
    )
  ).rows[0];
  if (!doc) throw new Error("No such page, or it is not yours to read.");

  const made: string[] = [];
  const missed: string[] = [];
  for (const change of a.changes.slice(0, 10)) {
    // The words to change are looked for in the page as it stands; a
    // proposal against words that are not there would have nothing to apply.
    const block = doc.content.find(
      (b) => b.id && blockText(b).includes(change.find),
    );
    if (!block?.id) {
      missed.push(change.find);
      continue;
    }
    const source = blockText(block);
    const at = source.indexOf(change.find);
    await pool.query(
      `INSERT INTO doc_suggestions
         (doc_id, user_id, block_id, kind, range_start, range_end,
          text, quote, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        doc.id,
        ctx.user.id,
        block.id,
        change.replace ? "replace" : "delete",
        at,
        at + change.find.length,
        change.replace,
        change.find,
        `Assistant${a.why ? ` · ${a.why.slice(0, 120)}` : ""}`,
      ],
    );
    made.push(change.find);
  }
  return {
    proposed: made.length,
    on: doc.title,
    not_found: missed,
    note: made.length
      ? "These wait beside the page for the user to take or leave. Say what you proposed; never say the page is changed."
      : "Nothing matched. Quote the words exactly as get_doc returned them.",
  };
}

export async function runTool(
  call: ToolCall,
  ctx: AgentContext,
): Promise<{ content: string; isError: boolean }> {
  const name = call.name.replace(/^functions\./, "").trim();
  if (
    ctx.projectDraft &&
    (name.startsWith("propose_") || name === "plan_schedule")
  )
    return errorResult(
      "A project is already drafted for review. Do not add separate changes or schedules to this turn.",
    );
  const found = TOOLS.find((t) => t.spec.name === name);
  if (!found)
    return errorResult(
      `Unknown tool "${call.name.slice(0, 60)}". Available: ${TOOL_SPECS.map((t) => t.name).join(", ")}.`,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments || "{}");
  } catch {
    return errorResult(
      `The arguments were not valid JSON. Call ${name} again with a JSON object.`,
    );
  }
  const parsed = found.args.safeParse(raw);
  if (!parsed.success)
    return errorResult(
      `Invalid arguments for ${name}: ${problem(parsed.error)}. Fix them and call it again.`,
    );
  try {
    return {
      content: cap(await found.run(ctx, parsed.data as never)),
      isError: false,
    };
  } catch (error) {
    return errorResult(problem(error));
  }
}

/** Tool results stay under a size budget; long lists lose items and say so. */
function cap(result: unknown): string {
  const text = JSON.stringify(result);
  if (text.length <= MAX_RESULT_CHARS) return text;
  const items = (result as { items?: unknown })?.items;
  if (Array.isArray(items)) {
    const shorter = {
      ...(result as object),
      items: [...items],
      more: true,
      shortened: true,
    };
    while (
      shorter.items.length &&
      JSON.stringify(shorter).length > MAX_RESULT_CHARS
    )
      shorter.items.pop();
    return JSON.stringify(shorter);
  }
  return `${text.slice(0, MAX_RESULT_CHARS - 16)}...(shortened)`;
}
