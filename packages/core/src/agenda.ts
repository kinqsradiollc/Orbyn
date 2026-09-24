import type { Doc, DocBlock } from "./docs.js";
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

/**
 * The title of one day's agenda, from its date ("2026-09-24"). Noon is used
 * so no time zone can tip it into the day before or after.
 */
export const agendaTitleOn = (date: string) =>
  agendaTitle(new Date(`${date}T12:00:00Z`), "UTC");

/**
 * One day's agenda, as stepping back and forward reads it: the day, its
 * title, today's date in your zone, and the page if one has been written.
 */
export type AgendaDay = {
  date: string;
  title: string;
  /** Today, in your own zone ("2026-09-24"). */
  today: string;
  doc: Doc | null;
};

/** "2026-09-24", for a string that should be one. */
export const isDateKey = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * The name of the Notes heading on an agenda. It is how "Rewrite from my
 * calendar" finds the part of the page that is yours: everything from Notes
 * down — your notes and the end-of-day answers — is kept as you wrote it.
 */
export const AGENDA_NOTES_ID = "agenda-notes";

/**
 * Where an agenda's Notes section starts: the heading named for it, or on a
 * page written before headings had names, the last heading that reads
 * "Notes". -1 when the page has none (someone took it out).
 */
export function agendaNotesAt(blocks: DocBlock[]): number {
  const named = blocks.findIndex((b) => b.id === AGENDA_NOTES_ID);
  if (named >= 0) return named;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.type === "heading" && b.text.trim().toLowerCase() === "notes")
      return i;
  }
  return -1;
}

/**
 * An agenda written again from the calendar, with its Notes section kept.
 * Everything above Notes comes from `fresh`; Notes and everything under it
 * comes from `current`, untouched. A page with no Notes section left has
 * nothing to keep, so it is simply the fresh page.
 */
export function keepAgendaNotes(
  current: DocBlock[],
  fresh: DocBlock[],
): DocBlock[] {
  const mine = agendaNotesAt(current);
  if (mine < 0) return fresh;
  const theirs = agendaNotesAt(fresh);
  const top = theirs < 0 ? fresh : fresh.slice(0, theirs);
  const kept = current.slice(mine);
  // A heading with no name yet takes the Notes name, so the next rewrite
  // finds it however it is renamed. One that already has a name keeps it:
  // remarks may be pointing at it.
  if (!kept[0].id) kept[0] = { ...kept[0], id: AGENDA_NOTES_ID };
  return [...top, ...kept];
}

export type AgendaOptions = {
  now?: Date;
  timeZone: string;
  /** How many days ahead "Coming up" looks. */
  aheadDays?: number;
  /**
   * Everything on today's calendar: your events with repeats expanded, and
   * subscribed calendars (a timetable, shifts, exams). When given, the
   * schedule is written from this rather than from the items' own dates.
   */
  calendar?: AgendaEntry[];
  /** Time set aside today: task blocks and habit sessions. */
  setAside?: { title: string; start_at: string; end_at: string }[];
  /** Free stretches left in today's working hours. */
  freeStretches?: { start_at: string; end_at: string }[];
  /** Notable things in the days ahead: exams, all-day events, deadlines. */
  comingEvents?: AgendaEntry[];
  /** Free working time left today, in minutes. */
  freeMinutes?: number;
  /** The few tasks that matter most, in the app's own priority order. */
  priorities?: string[];
  /** A short summary of the day written by the assistant, when there is one. */
  brief?: string | null;
  /**
   * The day's name when the page is for a day other than today ("Friday"),
   * so its opening line doesn't call it today.
   */
  dayName?: string | null;
  /** Flashcards to review today and exams coming up, for people who study. */
  study?: {
    due: number;
    newCards: number;
    exams: { title: string; days_left: number; readiness: number | null }[];
  } | null;
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

const localHour = (iso: string, timeZone: string) =>
  Number(
    new Date(iso).toLocaleTimeString("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }),
  );

const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;

/**
 * Today's agenda, as a page to work from: a line on how the day looks (the
 * assistant's words when there are some), the few things that matter most,
 * the schedule by part of the day, focus time, what's due and what carried
 * over, what's coming, then room for notes and a short end-of-day review.
 * Sections with nothing in them are left out, so the page never opens on a
 * wall of empty headings. Calendar names stay out of it: a class reads like
 * any other event.
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
  todayTasks.sort(byTime);
  overdue.sort(byTime);
  soon.sort(byTime);

  // One schedule, whichever source it comes from.
  type Slot = {
    start: string;
    end: string | null;
    allDay: boolean;
    title: string;
    location: string;
  };
  const schedule: Slot[] = opts.calendar
    ? opts.calendar.map((e) => ({
        start: e.start_at,
        end: e.end_at,
        allDay: e.all_day,
        title: e.title,
        location: e.location,
      }))
    : events.sort(byTime).map((e) => ({
        start: e.due_at!,
        end: e.end_at ?? null,
        allDay: false,
        title: e.title,
        location: e.location ?? "",
      }));
  schedule.sort(
    (a, b) =>
      Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start),
  );

  const blocks: DocBlock[] = [];
  const line = (text: string) => blocks.push({ type: "paragraph", text });
  const head = (text: string, level: 2 | 3 = 2) =>
    blocks.push({ type: "heading", level, text });
  const bullet = (text: string) => blocks.push({ type: "bullet", text });
  const todo = (text: string) =>
    blocks.push({ type: "todo", done: false, text });
  const span = (start: string, end: string | null) =>
    end ? `${time(start, tz)}–${time(end, tz)}` : time(start, tz);

  // How the day looks before any list: the assistant's words when there are
  // some, otherwise one plain sentence.
  const parts = [
    schedule.length ? plural(schedule.length, "event") : "",
    todayTasks.length ? `${plural(todayTasks.length, "task")} due` : "",
    overdue.length ? `${overdue.length} carried over` : "",
  ].filter(Boolean);
  const other = opts.dayName?.trim() || null;
  const free =
    opts.freeMinutes == null || !parts.length
      ? ""
      : opts.freeMinutes >= 15
        ? other
          ? ` About ${hours(opts.freeMinutes)} of your working time is free.`
          : ` About ${hours(opts.freeMinutes)} of your working time is still free.`
        : other
          ? " Your working hours are full."
          : " Your working hours are full for the rest of today.";
  line(
    opts.brief?.trim()
      ? opts.brief.trim()
      : parts.length
        ? `${other ?? "Today"}: ${parts.join(", ")}.${free}`
        : overdue.length
          ? other
            ? `Nothing is due on ${other} — a good moment to clear what slipped.`
            : "Nothing is due today — a good moment to clear what slipped."
          : other
            ? `Nothing scheduled on ${other}. The page is yours.`
            : "Nothing scheduled today. The page is yours.",
  );

  const priorities = (opts.priorities ?? []).slice(0, 3);
  if (priorities.length) {
    head("Top priorities");
    for (const p of priorities) todo(p);
  }

  if (schedule.length) {
    head("Schedule");
    for (const e of schedule.filter((x) => x.allDay))
      bullet(`All day · ${e.title}${e.location ? ` — ${e.location}` : ""}`);
    const timed = schedule.filter((x) => !x.allDay);
    const parts: [string, (h: number) => boolean][] = [
      ["Morning", (h) => h < 12],
      ["Afternoon", (h) => h >= 12 && h < 17],
      ["Evening", (h) => h >= 17],
    ];
    for (const [name, test] of parts) {
      const here = timed.filter((e) => test(localHour(e.start, tz)));
      if (!here.length) continue;
      head(name, 3);
      for (const e of here)
        bullet(
          `${span(e.start, e.end)} · ${e.title}${e.location ? ` — ${e.location}` : ""}`,
        );
    }
  }

  const setAside = [...(opts.setAside ?? [])].sort((a, b) =>
    a.start_at.localeCompare(b.start_at),
  );
  const stretches = (opts.freeStretches ?? []).slice(0, 4);
  if (setAside.length || stretches.length) {
    head("Focus time");
    for (const b of setAside)
      bullet(`${span(b.start_at, b.end_at)} · ${b.title}`);
    if (stretches.length)
      line(
        `Free: ${stretches.map((f) => span(f.start_at, f.end_at)).join(", ")}.`,
      );
  }

  const study = opts.study;
  if (study && (study.due || study.newCards || study.exams.length)) {
    head("Study");
    if (study.due || study.newCards)
      bullet(
        [
          study.due ? plural(study.due, "card") + " to review" : "",
          study.newCards ? `${study.newCards} new` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    for (const e of study.exams.slice(0, 3))
      bullet(
        `${e.title} in ${plural(e.days_left, "day")}${
          e.readiness == null
            ? ""
            : ` · ${Math.round(e.readiness * 100)}% known well`
        }`,
      );
  }

  if (todayTasks.length) {
    head("Due today");
    for (const t of todayTasks) todo(t.title);
  }

  if (overdue.length) {
    head("Carried over");
    for (const t of overdue) todo(t.title);
  }

  const comingEvents = opts.comingEvents ?? [];
  if (soon.length || comingEvents.length) {
    head("Coming up");
    const coming = [
      ...soon.map((t) => ({ at: t.due_at!, text: t.title })),
      ...comingEvents.map((e) => ({
        at: e.start_at,
        text: `${e.title}${e.all_day ? "" : ` at ${time(e.start_at, tz)}`}`,
      })),
      // Rows can bring Date objects rather than ISO strings; compare instants.
    ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    for (const c of coming) bullet(`${dayLabel(c.at, tz)} · ${c.text}`);
  }

  // Yours from here down: a rewrite never touches Notes or what follows it.
  blocks.push({
    type: "heading",
    level: 2,
    text: "Notes",
    id: AGENDA_NOTES_ID,
  });
  line("");

  head("End of day");
  bullet("What went well: ");
  bullet("What to carry into tomorrow: ");
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
