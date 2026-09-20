import type { DocBlock } from "./docs.js";
import { localDateKey } from "./time.js";
import type { Item } from "./types.js";

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
};

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
      if (key === todayKey && !DONE(item.status)) events.push(item);
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

  // One sentence that says how the day looks before any list.
  const load = events.length + todayTasks.length;
  line(
    load === 0
      ? overdue.length
        ? "Nothing is due today — a good moment to clear what slipped."
        : "Nothing scheduled today. The page is yours."
      : `${load} thing${load === 1 ? "" : "s"} on today${
          overdue.length ? `, and ${overdue.length} that slipped` : ""
        }.`,
  );

  if (events.length) {
    head("Your day");
    for (const e of events)
      blocks.push({
        type: "bullet",
        text: `${time(e.due_at!, tz)} — ${e.title}${
          e.location ? ` (${e.location})` : ""
        }`,
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

  if (soon.length) {
    head(`Coming up`);
    for (const t of soon)
      blocks.push({
        type: "bullet",
        text: `${localDateKey(new Date(t.due_at!), tz)} — ${t.title}`,
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
