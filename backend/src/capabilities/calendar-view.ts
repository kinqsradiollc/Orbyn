import { z } from "zod";
import { addDays, dayTime, localDateKey } from "@orbyn/core";
import { inSpaces } from "../lib/visibility.js";
import {
  busyIntervals,
  calendarEntries,
  derivedBlocks,
  loadPlaces,
  loadPrefs,
  timeBlocks,
} from "../modules/planner/calendar.js";
import { freeSpans, workingSpans } from "../modules/planner/plans.js";
import { externalEntries } from "../modules/planner/subscriptions.js";
import { READ, minutesText } from "./common.js";
import { both, cleanTitle, fence, mdLink } from "./format.js";
import { refs } from "./refs.js";
import { CapabilityError, defineCapability } from "./registry.js";

/**
 * The calendar for up to 31 days, as the person sees it: events (repeats
 * expanded), deadlines, planned sessions, habit sessions, travel and buffers,
 * and subscribed calendars (marked, and fenced as outside content). It can
 * also list free stretches of a given length inside working hours, and
 * filter by words in the title (calendar search).
 */

const when = z.object({ at: z.string(), local: z.string() });

const item = z.object({
  kind: z.enum([
    "event",
    "deadline",
    "session",
    "habit",
    "travel",
    "buffer",
    "calendar",
  ]),
  id: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  start: when,
  end: when.nullable(),
  all_day: z.boolean(),
  busy: z.boolean(),
  team: z.string().nullable(),
  provenance: z.string(),
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const getCalendar = defineCapability({
  name: "get_calendar",
  title: "Calendar",
  description:
    'The calendar from a day (default today) for up to 31 days, in the person\'s time zone: events with repeats expanded, task deadlines, planned sessions, habit sessions, travel and buffer time, and events from subscribed calendars (marked "calendar", outside content). Filter by words in the title with query. With free_minutes, also lists free stretches of at least that long inside working hours.',
  input: z
    .object({
      from: z
        .string()
        .regex(DAY, "from is a date: YYYY-MM-DD")
        .optional()
        .describe(
          "First day, YYYY-MM-DD in the person's time zone (default today).",
        ),
      days: z.number().int().min(1).max(31).default(7),
      query: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe("Only entries whose title has these words."),
      free_minutes: z
        .number()
        .int()
        .min(5)
        .max(600)
        .optional()
        .describe("Also list free stretches at least this long."),
    })
    .strict(),
  output: z.object({
    from: z.string(),
    days: z.number(),
    timezone: z.string(),
    entries: z.array(item),
    free: z
      .array(z.object({ start: when, end: when, minutes: z.number() }))
      .nullable(),
  }),
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    const tz = ctx.timezone;
    const userId = ctx.principal.user.id;
    const first = a.from ?? localDateKey(ctx.now, tz);
    if (Number.isNaN(Date.parse(`${first}T12:00:00Z`)))
      throw new CapabilityError("INVALID", "from isn't a real date.");
    const from = dayTime(first, 0, tz);
    const to = dayTime(addDays(first, a.days), 0, tz);
    const [prefs, events, sessions, habits, subscribed, places] =
      await Promise.all([
        loadPrefs(ctx.db, userId),
        calendarEntries(ctx.db, userId, from, to),
        timeBlocks(ctx.db, userId, from, to),
        ctx.db.query<{ start_at: Date; end_at: Date; name: string }>(
          `SELECT b.start_at, b.end_at, h.name FROM habit_blocks b
             JOIN habits h ON h.id = b.habit_id
            WHERE b.user_id = $1 AND b.end_at > $2 AND b.start_at < $3
            ORDER BY b.start_at LIMIT 200`,
          [userId, from, to],
        ),
        ctx.spaces.personal
          ? externalEntries(ctx.db, userId, from, to, { visible: true })
          : Promise.resolve([]),
        loadPlaces(ctx.db, userId),
      ]);
    const teamName = (id: string | null) =>
      id ? (ctx.principal.teams.find((t) => t.id === id)?.name ?? null) : null;
    const visible = events.filter(
      (e) =>
        inSpaces(ctx.spaces, e.team_id) &&
        e.status !== "cancelled" &&
        (e.kind === "event" || e.status !== "done"),
    );
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    const derived = derivedBlocks(visible, prefs, places, (at) =>
      day.format(new Date(at)),
    );
    const entries: z.output<typeof item>[] = [
      ...visible.map((e) => {
        const event = e.kind === "event";
        const r = refs({
          type: event ? "event" : "task",
          id: e.item_id,
          ...(e.occurrence && event ? { occurrence: e.occurrence } : {}),
        });
        return {
          kind: event ? ("event" as const) : ("deadline" as const),
          id: r.id,
          title: cleanTitle(e.title) || "Untitled",
          url: r.url,
          start: both(e.start_at, tz)!,
          end: event ? both(e.end_at, tz) : null,
          all_day: !!e.all_day,
          busy: !!e.busy,
          team: teamName(e.team_id),
          provenance: "you",
        };
      }),
      ...sessions
        .filter((s) => inSpaces(ctx.spaces, s.team_id))
        .map((s) => {
          const r = refs({ type: "task", id: s.item_id });
          return {
            kind: "session" as const,
            id: r.id,
            title: cleanTitle(s.title) || "Untitled",
            url: r.url,
            start: both(s.start_at, tz)!,
            end: both(s.end_at, tz),
            all_day: false,
            busy: true,
            team: teamName(s.team_id),
            provenance: "you",
          };
        }),
      ...(ctx.spaces.personal
        ? habits.rows.map((h) => ({
            kind: "habit" as const,
            id: null,
            title: cleanTitle(h.name),
            url: null,
            start: both(h.start_at, tz)!,
            end: both(h.end_at, tz),
            all_day: false,
            busy: true,
            team: null,
            provenance: "you",
          }))
        : []),
      ...derived
        .filter(
          (d) => d.start_at < to.toISOString() && d.end_at > from.toISOString(),
        )
        .map((d) => ({
          kind: d.kind,
          id: null,
          title: cleanTitle(
            d.label ?? (d.kind === "travel" ? "Travel" : "Buffer"),
          ),
          url: null,
          start: both(d.start_at, tz)!,
          end: both(d.end_at, tz),
          all_day: false,
          busy: true,
          team: null,
          provenance: "you",
        })),
      ...subscribed.map((e) => ({
        kind: "calendar" as const,
        id: null,
        // Busy time only, when the connection hides outside content.
        title: ctx.principal.flags.hide_outside_content
          ? "Busy (subscribed calendar)"
          : cleanTitle(e.title) || "Untitled",
        url: null,
        start: both(e.start_at, tz)!,
        end: both(e.end_at, tz),
        all_day: e.all_day,
        busy: e.busy,
        team: null,
        provenance: "subscribed_feed",
      })),
    ]
      .filter(
        (e) =>
          !a.query ||
          a.query
            .toLowerCase()
            .split(/\s+/)
            .every((w) => e.title.toLowerCase().includes(w)),
      )
      .sort((x, y) => x.start.at.localeCompare(y.start.at))
      .slice(0, 500);

    let free:
      | {
          start: z.output<typeof when>;
          end: z.output<typeof when>;
          minutes: number;
        }[]
      | null = null;
    if (a.free_minutes) {
      const start = new Date(Math.max(from.getTime(), ctx.now.getTime()));
      const busy = await busyIntervals(ctx.db, userId, start, to, {
        blocks: true,
        derived: true,
      });
      free = freeSpans(workingSpans(prefs, start, to), busy)
        .filter((s) => s.end - s.start >= a.free_minutes! * 60_000)
        .slice(0, 50)
        .map((s) => ({
          start: both(new Date(s.start), tz)!,
          end: both(new Date(s.end), tz)!,
          minutes: Math.round((s.end - s.start) / 60_000),
        }));
    }

    const own = entries.filter((e) => e.provenance === "you");
    const outside = entries.filter((e) => e.provenance !== "you");
    const md = [
      `# Calendar from ${first}, ${a.days} day${a.days === 1 ? "" : "s"} (${tz})`,
      ...(own.length
        ? own.map(
            (e) =>
              `- ${e.all_day ? `${e.start.local.slice(0, 10)} all day` : e.start.local}${e.end && !e.all_day ? `–${e.end.local.slice(-5)}` : ""} ${e.kind === "event" ? "" : `${e.kind}: `}${e.url ? mdLink(e.title, e.url) : e.title}${e.team ? ` (${e.team})` : ""}${e.id ? ` · ${e.id}` : ""}`,
          )
        : ["Nothing on the calendar."]),
    ];
    if (outside.length)
      md.push(
        "",
        "From subscribed calendars:",
        fence(
          outside.map((e) => `- ${e.start.local} ${e.title}`).join("\n"),
          "subscribed_feed",
        ),
      );
    if (free)
      md.push(
        "",
        `Free stretches of ${a.free_minutes} min or more:`,
        ...(free.length
          ? free.map(
              (f) =>
                `- ${f.start.local}–${f.end.local.slice(-5)} (${minutesText(f.minutes)})`,
            )
          : ["None inside working hours."]),
      );
    return {
      structured: { from: first, days: a.days, timezone: tz, entries, free },
      markdown: md.join("\n"),
      targets: [...new Set(entries.flatMap((e) => (e.id ? [e.id] : [])))].slice(
        0,
        50,
      ),
    };
  },
});
