import type { DocBlock } from "./docs.js";
import { localDateKey } from "./time.js";
import type { AgendaEntry, Item } from "./types.js";

/**
 * The daily agenda and meeting notes: documents Orbyn writes for you.
 *
 * Both are ordinary documents once created, so they can be edited like any
 * other page. The generators here are pure — they only shape planner data
 * into blocks — so the agenda reads the same with or without an AI provider
 * connected, and can be unit-tested.
 */

const DONE = (s: string) => s === "done" || s === "cancelled";

const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });

/** "Friday 5 December", in the reader's zone. */
export const agendaTitle = (now: Date, timeZone: string) =>
  now.toLocaleDateString("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

export type AgendaOptions = {
  now?: Date;
  timeZone: string;
  /** How many days ahead "Coming up" looks. */
  aheadDays?: number;
  /**
   * Everything on today's calendar: your events with repeats expanded, and
   * subscribed calendars (a timetable, shifts, exams). When given, "Your
   * day" is written from this rather than from the items' own dates.
   */
  calendar?: AgendaEntry[];
  /** Time set aside today: task blocks and habit sessions. */
  setAside?: { title: string; start_at: string; end_at: string }[];
  /** Notable things in the days ahead: exams, all-day events, deadlines. */
  comingEvents?: AgendaEntry[];
  /** Free working time left today, in minutes. */
  freeMinutes?: number;
  /** A short summary of the day written by the assistant, when there is one. */
  brief?: string | null;
};

const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

const dayLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/**
 * Build today's agenda from the planner: what's on today, what slipped, and
 * what's coming. Sections with nothing in them are left out, so the page never
 * opens on a wall of empty headings.
 */
export function buildAgenda(items: Item[], opts: AgendaOptions): DocBlock[] {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone;
  const ahead = opts.aheadDays ?? 7;
  const todayKey = localDateKey(now, tz);
  const horizon = new Date(now.getTime() + ahead * 86_400_000);
  const horizonKey = localDateKey(horizon, tz);

  const events: Item[] = [];
  const todayTasks: Item[] = [];
  const overdue: Item[] = [];
  const soon: Item[] = [];

  for (const item of items) {
    if (!item.due_at) continue;
    const key = localDateKey(new Date(item.due_at), tz);
    if (item.kind === "event") {
      if (!opts.calendar && key === todayKey && !DONE(item.status))
        events.push(item);
      continue;
    }
    if (DONE(item.status)) continue;
    if (key === todayKey) todayTasks.push(item);
    else if (key < todayKey) overdue.push(item);
    else if (key <= horizonKey) soon.push(item);
  }

  const byTime = (a: Item, b: Item) =>
    new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime();
  events.sort(byTime);
  todayTasks.sort(byTime);
  overdue.sort(byTime);
  soon.sort(byTime);

  const blocks: DocBlock[] = [];
  const line = (text: string) => blocks.push({ type: "paragraph", text });
  const head = (text: string) =>
    blocks.push({ type: "heading", level: 2, text });

  // Today's calendar: all-day things first, then by time.
  const calendar = [...(opts.calendar ?? [])].sort(
    (a, b) =>
      Number(b.all_day) - Number(a.all_day) ||
      a.start_at.localeCompare(b.start_at),
  );
  const onToday = opts.calendar ? calendar.length : events.length;

  // How the day looks before any list: the assistant's words when there are
  // some, otherwise one plain sentence.
  const load = onToday + todayTasks.length;
  const free =
    opts.freeMinutes == null || !load
      ? ""
      : opts.freeMinutes >= 15
        ? ` About ${hours(opts.freeMinutes)} of your working time is still free.`
        : " Your working hours are full for the rest of today.";
  line(
    opts.brief?.trim()
      ? opts.brief.trim()
      : load === 0
        ? overdue.length
          ? "Nothing is due today — a good moment to clear what slipped."
          : "Nothing scheduled today. The page is yours."
        : `${load} thing${load === 1 ? "" : "s"} on today${
            overdue.length ? `, and ${overdue.length} that slipped` : ""
          }.${free}`,
  );

  if (opts.calendar ? calendar.length : events.length) {
    head("Your day");
    if (opts.calendar)
      for (const e of calendar)
        blocks.push({
          type: "bullet",
          text: `${e.all_day ? "All day" : `${time(e.start_at, tz)}–${time(e.end_at, tz)}`} — ${e.title}${
            e.location ? ` (${e.location})` : ""
          }${e.calendar ? ` · ${e.calendar}` : ""}`,
        });
    else
      for (const e of events)
        blocks.push({
          type: "bullet",
          text: `${time(e.due_at!, tz)} — ${e.title}${
            e.location ? ` (${e.location})` : ""
          }`,
        });
  }

  const setAside = [...(opts.setAside ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  if (setAside.length) {
    head("Time set aside");
    for (const b of setAside)
      blocks.push({
        type: "bullet",
        text: `${time(b.start_at, tz)}–${time(b.end_at, tz)} — ${b.title}`,
      });
  }

  if (todayTasks.length) {
    head("To do today");
    for (const t of todayTasks)
      blocks.push({ type: "todo", done: false, text: t.title });
  }

  if (overdue.length) {
    head("Slipped");
    for (const t of overdue)
      blocks.push({ type: "todo", done: false, text: t.title });
  }

  const comingEvents = opts.comingEvents ?? [];
  if (soon.length || comingEvents.length) {
    head(`Coming up`);
    const coming = [
      ...soon.map((t) => ({ at: t.due_at!, text: t.title })),
      ...comingEvents.map((e) => ({
        at: e.start_at,
        text: `${e.title}${e.all_day ? "" : ` at ${time(e.start_at, tz)}`}${
          e.calendar ? ` · ${e.calendar}` : ""
        }`,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    for (const c of coming)
      blocks.push({
        type: "bullet",
        text: `${dayLabel(c.at, tz)} — ${c.text}`,
      });
  }

  head("Notes");
  blocks.push({ type: "paragraph", text: "" });
  return blocks;
}

/** The starting shape of a meeting note, ready to type into. */
export function meetingNoteTemplate(event: {
  title: string;
  due_at?: string | null;
  location?: string;
  timeZone: string;
}): DocBlock[] {
  const when = event.due_at
    ? `${localDateKey(new Date(event.due_at), event.timeZone)} at ${time(
        event.due_at,
        event.timeZone,
      )}`
    : "Not scheduled";
  return [
    {
      type: "paragraph",
      text: `${when}${event.location ? ` · ${event.location}` : ""}`,
    },
    { type: "heading", level: 2, text: "Agenda" },
    { type: "bullet", text: "" },
    { type: "heading", level: 2, text: "Notes" },
    { type: "paragraph", text: "" },
    { type: "heading", level: 2, text: "Decisions" },
    { type: "bullet", text: "" },
    { type: "heading", level: 2, text: "Action items" },
    { type: "todo", done: false, text: "" },
  ];
}
