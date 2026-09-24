import { z } from "zod";
import { addDays, dayTime, localDateKey } from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import {
  Params,
  inSpaces,
  scopeFor,
  visibleItems,
  type Spaces,
} from "../lib/visibility.js";
import { calendarEntries, timeBlocks } from "../modules/planner/calendar.js";
import { upNext } from "../modules/planner/next.js";
import { externalEntries } from "../modules/planner/subscriptions.js";
import { READ, minutesText } from "./common.js";
import { both, cleanTitle, fence, localTime, mdLink } from "./format.js";
import { refs, todayUrl } from "./refs.js";
import { defineCapability } from "./registry.js";

/**
 * The Today list for an agent: what's planned (sessions and events), what's
 * due, and what's late, for the person's own local day, plus what to do
 * next. It reads only: it never makes the day's agenda page and never syncs
 * study cards.
 *
 * todayForPrincipal() is the one seam: it takes the same inputs as the
 * app's Today list (the person, the spaces this principal reaches, now and
 * the time zone; plus whether outside content is hidden) and returns
 * TodayList, documented below. When the shared core todayList() lands
 * (Phase 1), point this function at it and keep the output shape; get_today
 * and the orbyn://today resource follow.
 */

const when = z
  .object({
    at: z.string().describe("ISO 8601 instant."),
    local: z.string().describe("The same, in the person's time zone."),
  })
  .describe("An instant, exact and local.");

const entry = z.object({
  kind: z
    .enum(["session", "event", "calendar"])
    .describe(
      '"session": time set aside for a task; "event"; "calendar": from a subscribed calendar.',
    ),
  id: z.string().nullable().describe("task:<id> or event:<id>@<occurrence>."),
  title: z.string(),
  url: z.string().nullable(),
  start: when,
  end: when.nullable(),
  all_day: z.boolean(),
  after_deadline: z
    .boolean()
    .describe("A session that ends after its task's deadline."),
  provenance: z.string().describe('"you", or where the text came from.'),
});

const task = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  due: when.describe("The deadline."),
  priority: z.string(),
  status: z.string(),
  planned_minutes: z
    .number()
    .describe("Minutes of the person's sessions that end before the deadline."),
  estimate_minutes: z.number().nullable(),
});

/**
 * The Today list (TodayList): the person's local day, what's planned in
 * order, what's due and late, what to do next, and what waits for them.
 */
export const todayOutput = z.object({
  day: z.string().describe("The local day, YYYY-MM-DD."),
  timezone: z.string(),
  now: when,
  url: z.string().describe("Today in the web app."),
  free: z
    .object({ minutes: z.number(), until: when, before: z.string().nullable() })
    .nullable()
    .describe(
      "Free time from now until the next commitment, within working hours.",
    ),
  planned: z
    .array(entry)
    .describe("Sessions and events today, in order; repeats expanded."),
  due: z.array(task).describe("Open tasks with a deadline today."),
  late: z
    .array(task)
    .describe("Open tasks past their deadline, latest first (at most 20)."),
  late_total: z.number().describe("How many tasks are late in all."),
  up_next: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        minutes: z.number(),
        why: z.array(z.string()),
      }),
    )
    .describe("What to do next, with the reasons."),
  needs_you: z
    .object({ asks: z.number() })
    .describe("Teammates' requests waiting for an answer."),
});
export type TodayList = z.output<typeof todayOutput>;

const LATE_SHOWN = 20;

type DueRow = {
  id: string;
  title: string;
  due_at: Date;
  priority: string;
  status: string;
  estimate_minutes: number | null;
  planned_minutes: number;
};

/**
 * Today for one principal: events, sessions, what's due and what's late,
 * in the person's local day, reaching only the principal's spaces.
 * `hideOutside` shows subscribed calendars' events as busy time only.
 */
export async function todayForPrincipal(
  db: Queryable,
  who: { userId: string; spaces: Spaces; hideOutside?: boolean },
  now: Date,
  timezone: string,
): Promise<TodayList> {
  const tz = timezone;
  const day = localDateKey(now, tz);
  const from = dayTime(day, 0, tz);
  const to = dayTime(addDays(day, 1), 0, tz);
  const { userId, spaces } = who;

  const dueQuery = (range: "today" | "late") => {
    const p = new Params();
    const scope = scopeFor(spaces, p);
    const a = p.add(from);
    const cond =
      range === "today"
        ? `i.due_at >= ${a} AND i.due_at < ${p.add(to)}`
        : `i.due_at < ${a}`;
    return {
      sql: `SELECT i.id, i.title, i.due_at, i.priority, i.status, i.estimate_minutes,
                   coalesce((SELECT sum(extract(epoch FROM b.end_at - b.start_at) / 60)
                               FROM time_blocks b
                              WHERE b.item_id = i.id AND b.user_id = ${scope.user}
                                AND b.end_at <= i.due_at), 0)::int AS planned_minutes
              FROM items i
             WHERE ${visibleItems("i", scope)} AND i.kind <> 'event'
               AND i.status NOT IN ('done', 'cancelled') AND ${cond}
             ORDER BY i.due_at ${range === "late" ? "DESC" : ""}
             LIMIT ${range === "late" ? LATE_SHOWN : 100}`,
      values: p.values,
    };
  };
  const lateCount = (() => {
    const p = new Params();
    const scope = scopeFor(spaces, p);
    return {
      sql: `SELECT count(*)::int AS n FROM items i
             WHERE ${visibleItems("i", scope)} AND i.kind <> 'event'
               AND i.status NOT IN ('done', 'cancelled') AND i.due_at < ${p.add(from)}`,
      values: p.values,
    };
  })();
  const dueToday = dueQuery("today");
  const lateQ = dueQuery("late");

  const [events, subscribed, sessions, due, late, lateTotal, next, asks] =
    await Promise.all([
      calendarEntries(db, userId, from, to),
      spaces.personal
        ? externalEntries(db, userId, from, to, { visible: true })
        : Promise.resolve([]),
      timeBlocks(db, userId, from, to),
      db.query<DueRow>(dueToday.sql, dueToday.values),
      db.query<DueRow>(lateQ.sql, lateQ.values),
      db.query<{ n: number }>(lateCount.sql, lateCount.values),
      upNext(db, userId, now),
      db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM task_asks WHERE asked_of = $1 AND status IN ('open', 'countered')",
        [userId],
      ),
    ]);

  const deadlines = new Map<string, Date | null>();
  const sessionIds = [...new Set(sessions.map((s) => s.item_id))];
  if (sessionIds.length)
    for (const r of (
      await db.query<{ id: string; due_at: Date | null }>(
        "SELECT id, due_at FROM items WHERE id = ANY ($1::uuid[])",
        [sessionIds],
      )
    ).rows)
      deadlines.set(r.id, r.due_at);

  const planned: z.output<typeof entry>[] = [
    ...sessions
      .filter((s) => inSpaces(spaces, s.team_id))
      .filter((s) => s.status !== "done" && s.status !== "cancelled")
      .map((s) => {
        const r = refs({ type: "task", id: s.item_id });
        const deadline = deadlines.get(s.item_id);
        return {
          kind: "session" as const,
          id: r.id,
          title: cleanTitle(s.title) || "Untitled",
          url: r.url,
          start: both(s.start_at, tz)!,
          end: both(s.end_at, tz),
          all_day: false,
          after_deadline:
            !!deadline && Date.parse(s.end_at) > deadline.getTime(),
          provenance: "you",
        };
      }),
    ...events
      .filter((e) => e.kind === "event" && inSpaces(spaces, e.team_id))
      .filter((e) => e.status !== "done" && e.status !== "cancelled")
      .map((e) => {
        const r = refs({
          type: "event",
          id: e.item_id,
          ...(e.occurrence ? { occurrence: e.occurrence } : {}),
        });
        return {
          kind: "event" as const,
          id: r.id,
          title: cleanTitle(e.title) || "Untitled",
          url: r.url,
          start: both(e.start_at, tz)!,
          end: both(e.end_at, tz),
          all_day: !!e.all_day,
          after_deadline: false,
          provenance: "you",
        };
      }),
    ...subscribed.map((e) => ({
      kind: "calendar" as const,
      id: null,
      title: who.hideOutside
        ? "Busy (subscribed calendar)"
        : cleanTitle(e.title) || "Untitled",
      url: null,
      start: both(e.start_at, tz)!,
      end: both(e.end_at, tz),
      all_day: e.all_day,
      after_deadline: false,
      provenance: "subscribed_feed",
    })),
  ].sort((a, b) => a.start.at.localeCompare(b.start.at));

  const taskOf = (t: DueRow): z.output<typeof task> => {
    const r = refs({ type: "task", id: t.id });
    return {
      id: r.id,
      title: cleanTitle(t.title) || "Untitled",
      url: r.url,
      due: both(t.due_at, tz)!,
      priority: t.priority,
      status: t.status,
      planned_minutes: Number(t.planned_minutes),
      estimate_minutes: t.estimate_minutes,
    };
  };

  // Up next may name a task outside this principal's spaces: keep only
  // those it can see.
  const suggested = next.suggestions.map((s) => s.item_id);
  const allowed = new Set<string>();
  if (suggested.length) {
    const p = new Params();
    const scope = scopeFor(spaces, p);
    for (const r of (
      await db.query<{ id: string }>(
        `SELECT i.id FROM items i WHERE i.id = ANY (${p.add(suggested)}::uuid[]) AND ${visibleItems("i", scope)}`,
        p.values,
      )
    ).rows)
      allowed.add(r.id);
  }

  return {
    day,
    timezone: tz,
    now: both(now, tz)!,
    url: todayUrl(),
    free: next.window
      ? {
          minutes: next.window.minutes,
          until: both(next.window.end_at, tz)!,
          before: next.window.until ? cleanTitle(next.window.until) : null,
        }
      : null,
    planned,
    due: due.rows.map(taskOf),
    late: late.rows.map(taskOf),
    late_total: lateTotal.rows[0]?.n ?? 0,
    up_next: next.suggestions
      .filter((s) => allowed.has(s.item_id))
      .map((s) => {
        const r = refs({ type: "task", id: s.item_id });
        return {
          id: r.id,
          title: cleanTitle(s.title) || "Untitled",
          url: r.url,
          minutes: s.minutes,
          why: s.reasons.map((x) => cleanTitle(x)),
        };
      }),
    needs_you: { asks: asks.rows[0]?.n ?? 0 },
  };
}

/** The Today list as Markdown. */
export function todayMarkdown(t: TodayList): string {
  const out = [
    `# Today, ${t.day} (${t.timezone})`,
    `It is ${t.now.local}.` +
      (t.free
        ? ` Free for ${minutesText(t.free.minutes)}, until ${t.free.until.local.slice(-5)}${t.free.before ? ` (${t.free.before})` : ""}.`
        : ""),
  ];
  const outside = t.planned.filter((e) => e.provenance !== "you");
  const own = t.planned.filter((e) => e.provenance === "you");
  out.push("", "## Planned");
  if (!own.length && !outside.length) out.push("Nothing planned today.");
  for (const e of own) {
    const time = e.all_day
      ? "all day"
      : `${e.start.local.slice(-5)}${e.end ? `–${localTime(e.end.at, t.timezone).slice(-5)}` : ""}`;
    out.push(
      `- ${time} ${e.kind === "session" ? "Session: " : ""}${e.url ? mdLink(e.title, e.url) : e.title}${e.after_deadline ? " (after the deadline)" : ""}${e.id ? ` · ${e.id}` : ""}`,
    );
  }
  if (outside.length)
    out.push(
      fence(
        outside
          .map(
            (e) =>
              `- ${e.all_day ? "all day" : e.start.local.slice(-5)} ${e.title}`,
          )
          .join("\n"),
        "subscribed_feed",
      ),
    );
  out.push("", "## Due today");
  if (!t.due.length) out.push("Nothing due today.");
  for (const d of t.due)
    out.push(
      `- ${d.due.local.slice(-5)} ${mdLink(d.title, d.url)} (${d.priority}; ${d.planned_minutes} min planned${d.estimate_minutes ? ` of ${d.estimate_minutes}` : ""}) · ${d.id}`,
    );
  if (t.late.length) {
    out.push("", `## Late (${t.late_total})`);
    for (const d of t.late)
      out.push(`- was due ${d.due.local} ${mdLink(d.title, d.url)} · ${d.id}`);
    if (t.late_total > t.late.length)
      out.push(`- …and ${t.late_total - t.late.length} more.`);
  }
  if (t.up_next.length) {
    out.push("", "## Up next");
    for (const u of t.up_next)
      out.push(
        `- ${mdLink(u.title, u.url)}, ${u.minutes} min: ${u.why.join("; ")}`,
      );
  }
  if (t.needs_you.asks)
    out.push(
      "",
      `${t.needs_you.asks} request(s) from teammates wait for an answer.`,
    );
  return out.join("\n");
}

export const getToday = defineCapability({
  name: "get_today",
  title: "Today",
  description:
    "The Today list for the person's local day: the time now and free time until the next commitment; sessions and events in order (repeating events expanded, subscribed calendars marked); tasks due today with the minutes planned before each deadline; late tasks (at most 20, plus the total); Up next with the reasons; and how many teammate requests wait. Reads only.",
  input: z.object({}).strict(),
  output: todayOutput,
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx) {
    const today = await todayForPrincipal(
      ctx.db,
      {
        userId: ctx.principal.user.id,
        spaces: ctx.spaces,
        hideOutside: ctx.principal.flags.hide_outside_content,
      },
      ctx.now,
      ctx.timezone,
    );
    return {
      structured: today,
      markdown: todayMarkdown(today),
      links: [
        { uri: "orbyn://today", name: "Today", description: "The Today list" },
      ],
      targets: [
        ...today.due.map((d) => d.id),
        ...today.planned.flatMap((e) => (e.id ? [e.id] : [])),
      ],
    };
  },
});
