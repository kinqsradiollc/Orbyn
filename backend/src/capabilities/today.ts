import { z } from "zod";
import {
  clockMinutes,
  dayTime,
  todayList,
  weekdayOf,
  type TodayRow,
} from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import {
  Params,
  inSpaces,
  scopeFor,
  visibleItems,
  type Spaces,
} from "../lib/visibility.js";
import {
  DEFAULT_EVENT_MINUTES,
  blocksTime,
  derivedBlocks,
  loadPlaces,
  loadPrefs,
} from "../modules/planner/calendar.js";
import { upNext } from "../modules/planner/next.js";
import { externalEntries } from "../modules/planner/subscriptions.js";
import { todaySources } from "../modules/planner/today.js";
import { READ, minutesText } from "./common.js";
import {
  both,
  cleanTitle,
  fence,
  lineTitle,
  localTime,
  mdLink,
  titleFor,
  type Provenance,
} from "./format.js";
import { refs, todayUrl } from "./refs.js";
import { defineCapability } from "./registry.js";
import { itemSourceSql, itemSources } from "./sources.js";

/**
 * The Today list for an agent: what's planned (sessions and events), what's
 * due, and what's late, for the person's own local day, plus what to do
 * next. It reads only: it never makes the day's agenda page and never syncs
 * study cards.
 *
 * todayForPrincipal() builds it on the app's own Today list: core's
 * todayList() over the same gathered input as GET /today, narrowed to the
 * spaces this principal reaches, so the app and agents list the same day.
 * get_today and the orbyn://today resource both come through it.
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
  provenance: z
    .string()
    .describe(
      '"you", or where the title came from (a session carries its task\'s).',
    ),
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
  provenance: z.string().describe('"you", or where the title came from.'),
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
      "Free time from now until the next commitment this connection can see, within working hours.",
    ),
  planned: z
    .array(entry)
    .describe("Sessions and events today, in order; repeats expanded."),
  due: z
    .array(task)
    .describe(
      "The person's open tasks (their own, or assigned to them) with a deadline today, as the app's Today list shows them.",
    ),
  late: z
    .array(task)
    .describe(
      "The person's open tasks past their deadline, latest first (at most 20).",
    ),
  late_total: z.number().describe("How many tasks are late in all."),
  up_next: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.string(),
        minutes: z.number(),
        why: z.array(z.string()),
        provenance: z.string().describe('"you", or where the title came from.'),
      }),
    )
    .describe("What to do next, with the reasons."),
  needs_you: z
    .object({ asks: z.number() })
    .describe("Teammates' requests waiting for an answer."),
});
export type TodayList = z.output<typeof todayOutput>;

type Extras = {
  id: string;
  priority: string;
  status: string;
  estimate_minutes: number | null;
  planned_minutes: number;
  source: string | null;
};

/**
 * Today for one principal: the app's own Today list (core's todayList()
 * over planner/today.ts's todaySources(), the same list GET /today and
 * the apps show), reaching only the principal's spaces, plus free time,
 * Up next and teammates' requests. Every title carries where it came from;
 * `hideOutside` shows subscribed calendars' events as busy time only, and
 * titles from outside (a booking guest's, an email's subject) only by
 * their neutral name.
 */
export async function todayForPrincipal(
  db: Queryable,
  who: { userId: string; spaces: Spaces; hideOutside?: boolean },
  now: Date,
  timezone: string,
): Promise<TodayList> {
  const tz = timezone;
  const { userId, spaces } = who;
  const source = await todaySources(db, userId, now, tz, spaces);
  const list = todayList(source.input);
  const { day } = list;
  const from = source.from;
  const to = source.to;

  const asksQuery = (() => {
    const p = new Params();
    const scope = scopeFor(spaces, p);
    return {
      sql: `SELECT count(*)::int AS n FROM task_asks a JOIN items i ON i.id = a.item_id
             WHERE a.asked_of = ${scope.user} AND a.status IN ('open', 'countered')
               AND ${visibleItems("i", scope)}`,
      values: p.values,
    };
  })();
  const taskRows = list.rows.filter((r) => r.kind === "task" && r.item_id);
  // What the list doesn't carry for a task: its priority and estimate, and
  // the minutes of the person's sessions that end before its deadline.
  const extrasQuery = (() => {
    const p = new Params();
    const scope = scopeFor(spaces, p);
    return {
      sql: `SELECT i.id, i.priority, i.status, i.estimate_minutes,
                   ${itemSourceSql("i")} AS source,
                   coalesce((SELECT sum(extract(epoch FROM b.end_at - b.start_at) / 60)
                               FROM time_blocks b
                              WHERE b.item_id = i.id AND b.user_id = ${scope.user}
                                AND b.end_at <= i.due_at), 0)::int AS planned_minutes
              FROM items i
             WHERE i.id = ANY (${p.add(taskRows.map((r) => r.item_id))}::uuid[])
               AND ${visibleItems("i", scope)}`,
      values: p.values,
    };
  })();

  const [prefs, places, subscribedBusy, extrasRows, asks] = await Promise.all([
    loadPrefs(db, userId),
    loadPlaces(db, userId),
    // Hidden calendars still make the person busy (as in the planner).
    spaces.personal
      ? externalEntries(db, userId, from, to, { busy: true })
      : Promise.resolve([]),
    taskRows.length
      ? db.query<Extras>(extrasQuery.sql, extrasQuery.values)
      : Promise.resolve({ rows: [] as Extras[] }),
    db.query<{ n: number }>(asksQuery.sql, asksQuery.values),
  ]);
  const extras = new Map(extrasRows.rows.map((r) => [r.id, r]));

  // The day's entries in reach (todaySources already left out the rest).
  const reach = source.entries;
  // Where each event's and session's title came from: a booking guest, an
  // email, or the person.
  const itemIds = [
    ...new Set(
      list.rows.flatMap((r) =>
        r.kind !== "task" && r.item_id ? [r.item_id] : [],
      ),
    ),
  ];
  const sources = await itemSources(db, itemIds);
  const sourceOf = (id: string) =>
    sources.get(id) ?? extras.get(id)?.source ?? "you";
  const titled = (id: string, title: string, kind: string) =>
    titleFor(title, sourceOf(id), who.hideOutside, kind) || "Untitled";
  const subscribedTitle = (title: string) =>
    who.hideOutside
      ? "Busy (subscribed calendar)"
      : cleanTitle(title) || "Untitled";

  const session = (
    itemId: string,
    title: string,
    start: string,
    end: string,
    afterDeadline: boolean,
  ): z.output<typeof entry> => {
    const r = refs({ type: "task", id: itemId });
    return {
      kind: "session",
      id: r.id,
      title: titled(itemId, title, "task"),
      url: r.url,
      start: both(start, tz)!,
      end: both(end, tz),
      all_day: false,
      after_deadline: afterDeadline,
      provenance: sourceOf(itemId),
    };
  };
  const planned: z.output<typeof entry>[] = list.rows
    .flatMap((row): z.output<typeof entry>[] => {
      if (row.kind === "session" && row.item_id)
        return [
          session(
            row.item_id,
            row.title,
            row.start_at!,
            row.end_at!,
            row.after_deadline,
          ),
        ];
      if (row.kind === "task" && row.item_id)
        return row.sessions.map((s) =>
          session(
            row.item_id!,
            row.title,
            s.start_at,
            s.end_at,
            !!row.deadline_at &&
              Date.parse(s.end_at) > Date.parse(row.deadline_at),
          ),
        );
      if (row.kind !== "event") return [];
      if (!row.item_id)
        return [
          {
            kind: "calendar",
            id: null,
            title: subscribedTitle(row.title),
            url: null,
            start: both(row.start_at!, tz)!,
            end: both(row.end_at, tz),
            all_day: row.all_day,
            after_deadline: false,
            provenance: "subscribed_feed",
          },
        ];
      const r = refs({
        type: "event",
        id: row.item_id,
        ...(row.occurrence ? { occurrence: row.occurrence } : {}),
      });
      return [
        {
          kind: "event",
          id: r.id,
          title: titled(row.item_id, row.title, "event"),
          url: r.url,
          start: both(row.start_at!, tz)!,
          end: both(row.end_at, tz),
          all_day: row.all_day,
          after_deadline: false,
          provenance: sourceOf(row.item_id),
        },
      ];
    })
    .sort((a, b) => a.start.at.localeCompare(b.start.at));
  const subscribed = source.subscribed;

  // Free time from now until the next commitment in reach, inside working
  // hours; worked out here rather than taken from Up next, which looks at
  // every team and would name (and time) events this principal can't see.
  const workStart = dayTime(day, clockMinutes(prefs.work_start), tz);
  const workEnd = dayTime(day, clockMinutes(prefs.work_end), tz);
  const at = now.getTime();
  const working =
    prefs.work_days.includes(weekdayOf(day)) &&
    at >= workStart.getTime() &&
    at < workEnd.getTime();
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const timed = reach.filter(blocksTime);
  const endOf = (start: string, end: string | null) =>
    end ? Date.parse(end) : Date.parse(start) + DEFAULT_EVENT_MINUTES * 60_000;
  const busy = [
    ...timed.map((e) => ({
      start: Date.parse(e.start_at),
      end: endOf(e.start_at, e.end_at),
    })),
    ...derivedBlocks(reach, prefs, places, (t) =>
      localDay.format(new Date(t)),
    ).map((d) => ({
      start: Date.parse(d.start_at),
      end: Date.parse(d.end_at),
    })),
    ...subscribedBusy.map((e) => ({
      start: Date.parse(e.start_at),
      end: Date.parse(e.end_at),
    })),
  ].sort((a, b) => a.start - b.start);
  let free: TodayList["free"] = null;
  if (working && !busy.some((b) => b.start <= at && b.end > at)) {
    const nextBusy = busy.find((b) => b.start > at);
    const end = Math.min(nextBusy?.start ?? Infinity, workEnd.getTime());
    const minutes = Math.floor((end - at) / 60_000);
    if (minutes >= 5) {
      // Name what ends it (buffers and travel come just before an event).
      // Only the person's own events are named: text from outside (what a
      // booking guest typed, an email's subject, a subscribed calendar's
      // titles) goes only in the fenced list of what's planned, never here
      // or in Up next's reasons, which aren't fenced.
      const NEUTRAL: Record<string, string> = {
        booking_guest: "a booking",
        inbound_email: "an event from email",
      };
      const named = [
        ...timed.map((e) => ({
          start: Date.parse(e.start_at),
          title:
            NEUTRAL[sourceOf(e.item_id)] ?? titled(e.item_id, e.title, "event"),
        })),
        ...subscribed
          .filter((e) => e.busy && !e.all_day)
          .map((e) => ({
            start: Date.parse(e.start_at),
            title: "a subscribed calendar event",
          })),
      ]
        .filter((e) => e.start >= end && e.start <= end + 90 * 60_000)
        .sort((a, b) => a.start - b.start)[0];
      free = {
        minutes,
        until: both(new Date(end), tz)!,
        before:
          nextBusy && nextBusy.start < workEnd.getTime() && named
            ? named.title
            : null,
      };
    }
  }

  const taskOf = (row: TodayRow): z.output<typeof task> => {
    const id = row.item_id!;
    const r = refs({ type: "task", id });
    const x = extras.get(id)!;
    return {
      id: r.id,
      title:
        titleFor(row.title, x.source ?? "you", who.hideOutside) || "Untitled",
      url: r.url,
      due: both(row.deadline_at!, tz)!,
      priority: x.priority,
      status: x.status,
      planned_minutes: Number(x.planned_minutes),
      estimate_minutes: x.estimate_minutes,
      provenance: x.source ?? "you",
    };
  };

  // Up next from this principal's free time and its spaces' tasks only, so
  // no suggestion's minutes, reasons or order time or name an event out of
  // reach (Up next on its own looks at every team).
  const next = await upNext(db, userId, now, {
    window: free
      ? {
          start_at: now.toISOString(),
          end_at: free.until.at,
          minutes: free.minutes,
          until: free.before,
        }
      : null,
    reach: (teamId) => inSpaces(spaces, teamId),
  });
  // And only tasks it can see, checked as every other read is.
  // (With where each one's title came from.)
  const suggested = next.suggestions.map((s) => s.item_id);
  const allowed = new Map<string, string>();
  if (suggested.length) {
    const p = new Params();
    const scope = scopeFor(spaces, p);
    for (const r of (
      await db.query<{ id: string; source: string | null }>(
        `SELECT i.id, ${itemSourceSql("i")} AS source FROM items i
          WHERE i.id = ANY (${p.add(suggested)}::uuid[]) AND ${visibleItems("i", scope)}`,
        p.values,
      )
    ).rows)
      allowed.set(r.id, r.source ?? "you");
  }

  return {
    day,
    timezone: tz,
    now: both(now, tz)!,
    url: todayUrl(),
    free,
    planned,
    // Tasks due today by their deadline; late ones latest first (as listed).
    due: taskRows
      .filter((r) => r.due === "today" && extras.has(r.item_id!))
      .sort((a, b) => a.deadline_at!.localeCompare(b.deadline_at!))
      .map(taskOf),
    late: taskRows
      .filter((r) => r.due === "late" && extras.has(r.item_id!))
      .map(taskOf),
    late_total: list.late_total,
    up_next: next.suggestions
      .filter((s) => allowed.has(s.item_id))
      .map((s) => {
        const r = refs({ type: "task", id: s.item_id });
        const why = s.reasons.map((x) => cleanTitle(x));
        const source = allowed.get(s.item_id)!;
        return {
          id: r.id,
          title: titleFor(s.title, source, who.hideOutside) || "Untitled",
          url: r.url,
          minutes: s.minutes,
          why: why.length ? why : ["Next on your list"],
          provenance: source,
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
  // Outside text (subscribed calendars, what booking guests typed, emails'
  // subjects), fenced by where it came from.
  for (const source of [...new Set(outside.map((e) => e.provenance))])
    out.push(
      fence(
        outside
          .filter((e) => e.provenance === source)
          .map(
            (e) =>
              `- ${e.all_day ? "all day" : e.start.local.slice(-5)} ${e.kind === "session" ? "Session: " : ""}${e.title}${e.after_deadline ? " (after the deadline)" : ""}${e.id ? ` · ${e.id}` : ""}`,
          )
          .join("\n"),
        source as Provenance,
      ),
    );
  out.push("", "## Due today");
  if (!t.due.length) out.push("Nothing due today.");
  for (const d of t.due)
    out.push(
      `- ${d.due.local.slice(-5)} ${lineTitle(d.title, d.url, d.provenance)} (${d.priority}; ${d.planned_minutes} min planned${d.estimate_minutes ? ` of ${d.estimate_minutes}` : ""}) · ${d.id}`,
    );
  if (t.late.length) {
    out.push("", `## Late (${t.late_total})`);
    for (const d of t.late)
      out.push(
        `- was due ${d.due.local} ${lineTitle(d.title, d.url, d.provenance)} · ${d.id}`,
      );
    if (t.late_total > t.late.length)
      out.push(`- …and ${t.late_total - t.late.length} more.`);
  }
  if (t.up_next.length) {
    out.push("", "## Up next");
    for (const u of t.up_next)
      out.push(
        `- ${lineTitle(u.title, u.url, u.provenance)}, ${u.minutes} min: ${u.why.join("; ")}`,
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
    "The Today list for the person's local day: the time now and free time until the next commitment; sessions and events in order (repeating events expanded, subscribed calendars marked); the person's tasks (their own, or assigned to them) due today with the minutes planned before each deadline; late ones (at most 20, plus the total); Up next with the reasons; and how many teammate requests wait. Reads only.",
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
