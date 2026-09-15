import { z } from "zod";
import {
  KINDS,
  PRIORITIES,
  STATUSES,
  itemData,
  type Action,
  type SystemRole,
} from "@orbyn/core";
import { pool } from "../../../db/pool.js";
import { requireTeam, VISIBLE_ITEMS } from "../../../lib/teams.js";
import { mayChange, wantsDeletion } from "../guards.js";
import { offsetAt } from "../prompt.js";
import { localIso } from "../snapshot.js";
import type { JsonSchema, ToolCall, ToolSpec } from "./protocol.js";

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
  clarification: { question: string; options: string[] } | null;
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
  team_id: string | null;
  team_name: string | null;
  progress: number;
  steps_total: number;
  steps_done: number;
  version: number;
};

/** Text from the database, without control characters and cut to size. */
const clean = (text: unknown, max: number) =>
  Array.from(String(text ?? ""))
    .map((c) => (c < " " && c !== "\n" && c !== "\t" ? " " : c))
    .join("")
    .slice(0, max);

/**
 * "Wed 16 Sept, 07:00–08:00" in the user's timezone. Models misname weekdays
 * when they work them out from a date, so every item carries its own.
 */
export function whenLabel(
  start: Date | null,
  end: Date | null,
  timezone: string,
): string | null {
  if (!start) return null;
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${day}, ${time(start)}${end ? `–${time(end)}` : ""}`;
}

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
    ...(row.steps_total
      ? { checklist: `${row.steps_done}/${row.steps_total} done` }
      : {}),
  };
}

const ITEM_SELECT =
  "SELECT i.*, t.name AS team_name FROM items i LEFT JOIN teams t ON t.id = i.team_id";
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/** "YYYY-MM-DD" in the user's timezone. */
function localDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** A date or date-time from the model as an instant; bare values are local time. */
export function toInstant(
  value: string,
  timezone: string,
  endOfDay = false,
): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v))
    return `${v}T${endOfDay ? "23:59:59" : "00:00:00"}${offsetAt(timezone, new Date(`${v}T12:00:00Z`))}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) {
    const full = v.length === 16 ? `${v}:00` : v;
    return full + offsetAt(timezone, new Date(`${full}Z`));
  }
  return v;
}

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
         AND (i.status <> 'done' OR i.updated_at > now() - interval '7 days')
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
  const open = rows.filter((r) => r.status !== "done");
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
    note: "Only some items are listed here; use search_items for the rest.",
  };
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
  const words = [
    ...new Set(message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []),
  ]
    .filter((w) => !COMMON_WORDS.has(w))
    .slice(0, 12);
  if (!words.length) return [];
  const rows = (
    await pool.query<Row>(
      `SELECT * FROM (
         SELECT i.*, t.name AS team_name,
           (SELECT count(*) FROM unnest($2::text[]) w
            WHERE lower(i.title) LIKE '%' || w || '%') AS hits
         FROM items i LEFT JOIN teams t ON t.id = i.team_id
         WHERE ${VISIBLE_ITEMS}
           AND (i.status <> 'done' OR i.updated_at > now() - interval '14 days')
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
  else if (!a.include_done) where.push("i.status <> 'done'");
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
      `SELECT i.*, t.name AS team_name, count(*) OVER()::int AS total
       FROM items i LEFT JOIN teams t ON t.id = i.team_id
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
      if (full(ctx)) throw new Error(TOO_MANY);
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
      if (ctx.actions.some(same))
        throw new Error("Already proposed in this reply.");
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
    reminder_minutes: row.reminder_minutes,
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

const NO_ARGS: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const TOOLS: Tool[] = [
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
        "Find items by words, status, type, priority, team or due-date range, with the ids needed for changes. Leaves out done items unless include_done or status asks for them.",
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
];

export const TOOL_SPECS = TOOLS.map((t) => t.spec);

const errorResult = (message: string) => ({
  content: JSON.stringify({ error: message }),
  isError: true,
});

/** Run one tool call. Every failure comes back as a result the model can act on. */
export async function runTool(
  call: ToolCall,
  ctx: AgentContext,
): Promise<{ content: string; isError: boolean }> {
  const name = call.name.replace(/^functions\./, "").trim();
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
