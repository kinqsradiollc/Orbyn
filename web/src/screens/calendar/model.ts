import {
  addDays,
  dayTime,
  localDateKey,
  weekStartOf,
  zonedParts,
  type CalendarEntry,
  type CalendarSet,
  type ExternalEntry,
  type FieldDate,
  type FrameOccurrence,
  type HabitBlock,
  type Plan,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";

export type Mode = "stage" | "month" | "week" | "day" | "agenda";

export const MODES: { id: Mode; label: string; key: string }[] = [
  { id: "stage", label: "3D", key: "s" },
  { id: "month", label: "Month", key: "m" },
  { id: "week", label: "Week", key: "w" },
  { id: "day", label: "Day", key: "d" },
  { id: "agenda", label: "Agenda", key: "a" },
];

export const isMode = (value: string | null): value is Mode =>
  MODES.some((m) => m.id === value);

export const AGENDA_DAYS = 14;
export const SNAP = 15;
export const DAY_MINUTES = 1440;
export const TASK_MIME = "application/x-orbyn-task";

/** Where a date field's deadline comes from, kept in its entry's key. */
const FIELD_SOURCE = "field:";

/** What someone has opened: everything the calendar draws, one shape. */
export type Picked =
  | { kind: "entry"; entry: CalendarEntry }
  | { kind: "block"; block: TimeBlock }
  | { kind: "frame"; frame: FrameOccurrence }
  | { kind: "external"; event: ExternalEntry }
  | { kind: "habit"; habit: HabitBlock }
  | { kind: "ghost"; ghost: PlannedBlock };

export type PickedRef = { kind: Picked["kind"]; key: string };

/** Unique per occurrence: repeating items share an item id. */
export const entryKey = (e: CalendarEntry) => `${e.item_id}@${e.start_at}`;
export const externalKey = (x: ExternalEntry) =>
  `${x.subscription_id}@${x.start_at}@${x.title}`;
export const frameKey = (f: FrameOccurrence) => `${f.frame_id}@${f.start_at}`;
export const ghostKey = (g: PlannedBlock) => `${g.item_id}@${g.start_at}`;

export function keyOf(p: Picked): PickedRef {
  if (p.kind === "entry") return { kind: p.kind, key: entryKey(p.entry) };
  if (p.kind === "block") return { kind: p.kind, key: p.block.id };
  if (p.kind === "frame") return { kind: p.kind, key: frameKey(p.frame) };
  if (p.kind === "external") return { kind: p.kind, key: externalKey(p.event) };
  if (p.kind === "habit") return { kind: p.kind, key: p.habit.id };
  return { kind: p.kind, key: ghostKey(p.ghost) };
}

/** End of an entry; entries without one get a default length. */
export const entryEnd = (e: CalendarEntry) =>
  new Date(
    e.end_at
      ? Date.parse(e.end_at)
      : Date.parse(e.start_at) + (e.kind === "event" ? 60 : 30) * 60_000,
  );

/** Anything with a start and an optional end (entries, external events). */
type Timed = { start_at: string; end_at: string | null; all_day?: boolean };

const lastDayOf = (e: Timed, tz: string) =>
  e.end_at && Date.parse(e.end_at) > Date.parse(e.start_at)
    ? localDateKey(new Date(Date.parse(e.end_at) - 1), tz)
    : localDateKey(new Date(e.start_at), tz);

export const firstDayOf = (e: Timed, tz: string) =>
  localDateKey(new Date(e.start_at), tz);
export { lastDayOf };

/** Whole-day items and ones spanning several days have no place on the hours. */
export const isAllDayEntry = (e: Timed, tz: string) =>
  !!e.all_day || lastDayOf(e, tz) > firstDayOf(e, tz);

export const entryOnDay = (e: Timed, day: string, tz: string) =>
  firstDayOf(e, tz) <= day && day <= lastDayOf(e, tz);

/** Minutes from midnight on `day`'s clock in `tz`. */
export function clockOf(iso: string, tz: string) {
  const p = zonedParts(new Date(iso), tz);
  return p.hour * 60 + p.minute;
}

/** The part of [start, end) on a day, in minutes from its midnight. */
export function spanOn(start: string, end: string, day: string, tz: string) {
  const dayStart = dayTime(day, 0, tz).getTime();
  const dayEnd = dayTime(addDays(day, 1), 0, tz).getTime();
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (s >= dayEnd || e <= dayStart) return null;
  return {
    top: (Math.max(s, dayStart) - dayStart) / 60_000,
    bottom: (Math.min(e, dayEnd) - dayStart) / 60_000,
  };
}

/** Whether a calendar set shows something (no set shows everything). */
export function inSet(
  set: CalendarSet | null,
  x: { team_id: string | null; list_id: string | null },
) {
  if (!set) return true;
  const place = x.team_id ? set.team_ids.includes(x.team_id) : set.personal;
  const list =
    !set.list_ids.length || (!!x.list_id && set.list_ids.includes(x.list_id));
  return place && list;
}

/** The days a mode covers: the one range every view and the navigator share. */
export function rangeOf(mode: Mode, date: string, span: number) {
  if (mode === "month") {
    const first = monthWeeks(date)[0][0];
    return { first, days: 42 };
  }
  if (mode === "stage") return { first: weekStartOf(date), days: 7 };
  if (mode === "week")
    return { first: span === 7 ? weekStartOf(date) : date, days: span };
  if (mode === "day") return { first: date, days: 1 };
  return { first: date, days: AGENDA_DAYS };
}

export const daysFrom = (first: string, count: number) =>
  Array.from({ length: count }, (_, n) => addDays(first, n));

/** Six Monday-first weeks around a day's month, the same week the 3D view uses. */
export function monthWeeks(date: string) {
  const first = weekStartOf(`${date.slice(0, 8)}01`);
  return Array.from({ length: 6 }, (_, w) =>
    daysFrom(addDays(first, w * 7), 7),
  );
}

/** The same place in the month before or after, on its first day. */
export function stepMonth(date: string, by: number) {
  const [y, m] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1 + by, 1));
  return next.toISOString().slice(0, 10);
}

/** A date field's day, as a read-only all-day entry beside subscriptions. */
export function fieldEntry(d: FieldDate, tz: string): ExternalEntry {
  return {
    subscription_id: `${FIELD_SOURCE}${d.target}:${d.target_id}`,
    name: d.target === "page" ? "A page's date" : "A project's date",
    color: "var(--accent)",
    title: `${d.field_name} · ${d.title || "Untitled"}`,
    start_at: dayTime(d.date, 0, tz).toISOString(),
    end_at: dayTime(addDays(d.date, 1), 0, tz).toISOString(),
    all_day: true,
    location: "",
    busy: false,
  };
}

/** The page or project an entry made from a date field points at. */
export function fieldTarget(event: ExternalEntry) {
  if (!event.subscription_id.startsWith(FIELD_SOURCE)) return null;
  const [target, id] = event.subscription_id
    .slice(FIELD_SOURCE.length)
    .split(":");
  return { target: target as FieldDate["target"], id };
}

/** A plan's sessions as drawn: new ones, and ticked moves of existing ones. */
export function proposalsOf(plan: Plan, ticks: Record<string, boolean>) {
  const moved = (plan.moves ?? []).filter(
    (m) => ticks[m.block_id] ?? m.selected,
  );
  return [
    ...plan.blocks,
    ...moved.map((m): PlannedBlock => ({
      item_id: m.item_id,
      title: m.title,
      start_at: m.start_at,
      end_at: m.end_at,
      frame_id: null,
      frame_name: null,
      part: 1,
      parts: 1,
      score: 0,
    })),
  ];
}

/** "9:00" of the next quarter on a day (today: from now; others: 9 AM). */
export function nextQuarter(day: string, tz: string, now = new Date()) {
  if (day !== localDateKey(now, tz)) return dayTime(day, 9 * 60, tz);
  const at = new Date(now);
  at.setMinutes(Math.ceil((at.getMinutes() + 1) / SNAP) * SNAP, 0, 0);
  return at;
}

/** Events with a meeting link can be joined from 5 minutes before they start. */
export function joinable(
  e: { meeting_url?: string; start_at: string; end_at: string | null },
  now = Date.now(),
) {
  if (!e.meeting_url) return false;
  const start = Date.parse(e.start_at);
  const end = e.end_at ? Date.parse(e.end_at) : start + 60 * 60_000;
  return now >= start - 5 * 60_000 && now < end;
}

export const isTyping = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null;
  return (
    !!target &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
};

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export const statusOf = (error: unknown) =>
  (error as { status?: number; statusCode?: number })?.status ??
  (error as { statusCode?: number })?.statusCode;
