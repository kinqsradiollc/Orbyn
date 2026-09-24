import {
  dueDayAt,
  formatRrule,
  isClosed,
  parseRrule,
  priorityScore,
  zonedParts,
  type Frequency,
  type Item,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";
import { isOverdue } from "./tasks";

/** The browser's IANA time zone, e.g. "Australia/Melbourne". */
export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Every IANA zone the browser knows, for pickers. */
export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [deviceTimeZone(), "UTC"];
  }
}

/** "Melbourne" from "Australia/Melbourne". */
export const zoneCity = (zone: string) =>
  zone.split("/").pop()!.replaceAll("_", " ");

/** "45 min", "1 h", "1 h 30 min". */
export function minutesLabel(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Quick picks for a task's estimate, in minutes. */
export const ESTIMATES = [15, 30, 45, 60, 90, 120];

/** Size buckets used by the task filters and grouping. */
export type Size = "quick" | "short" | "long" | "none";
export const SIZE_LABELS: Record<Size, string> = {
  quick: "Up to 15 min",
  short: "Up to 1 hour",
  long: "Longer than 1 hour",
  none: "No estimate",
};
export const sizeOf = (i: Pick<Item, "estimate_minutes">): Size => {
  const m = i.estimate_minutes;
  if (!m) return "none";
  if (m <= 15) return "quick";
  if (m <= 60) return "short";
  return "long";
};

/** Due-date buckets for the task filter. */
export type DueFilter =
  "any" | "overdue" | "today" | "tomorrow" | "soon" | "week" | "none";
/**
 * Whether a task falls in a due bucket. "today" is planned or due today:
 * `plannedToday` holds the tasks with a session of yours today.
 */
export function matchesDue(
  i: Item,
  due: DueFilter,
  now = new Date(),
  plannedToday?: Set<string>,
) {
  if (due === "any") return true;
  if (due === "none") return !i.due_at;
  if (due === "today" && plannedToday?.has(i.id)) return true;
  if (!i.due_at) return false;
  if (due === "overdue") return isOverdue(i, now);
  // The day it's due by: an all-day task's last day, a span's end.
  const at = dueDayAt(i)!;
  /** Local midnight `n` days from today. */
  const day = (n: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const within = (from: number, to: number) => at >= day(from) && at < day(to);
  if (due === "today") return within(0, 1);
  if (due === "tomorrow") return within(1, 2);
  // Due soon: the rest of the coming week, after today and tomorrow.
  if (due === "soon") return within(2, 7);
  // This week: from today through Saturday (weeks start on Sunday).
  return within(0, 7 - now.getDay());
}

/** Open tasks first, most pressing first; finished ones last. */
export function byScore(now = new Date()) {
  return (a: Item, b: Item) =>
    Number(isClosed(a.status)) - Number(isClosed(b.status)) ||
    priorityScore(b, now) - priorityScore(a, now) ||
    a.title.localeCompare(b.title);
}

/** Open tasks sorted by how pressing they are. */
export const nextUp = (items: Item[], exclude?: string, limit = 5) =>
  items
    .filter((i) => i.kind === "task" && !isClosed(i.status) && i.id !== exclude)
    .sort(byScore())
    .slice(0, limit);

// ---- Repeating items ---------------------------------------------------------

export type RepeatFreq = "none" | "DAILY" | "WEEKDAYS" | Frequency;
export type RepeatDraft = {
  freq: RepeatFreq;
  interval: number;
  /** 0 = Sunday. */
  byDay: number[];
  ends: "never" | "count" | "until";
  count: number;
  until: string;
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The picker's state for a saved rule (or "none"). */
export function repeatDraft(
  rrule: string | null | undefined,
  dueAt: string | null,
): RepeatDraft {
  const day = dueAt ? new Date(dueAt).getDay() : new Date().getDay();
  const blank: RepeatDraft = {
    freq: "none",
    interval: 1,
    byDay: [day],
    ends: "never",
    count: 10,
    until: "",
  };
  const rule = rrule ? parseRrule(rrule) : null;
  if (!rule) return blank;
  const weekdays =
    rule.freq === "WEEKLY" &&
    rule.interval === 1 &&
    rule.byDay.join(",") === "1,2,3,4,5";
  return {
    freq: weekdays ? "WEEKDAYS" : rule.freq,
    interval: rule.interval,
    byDay: rule.byDay.length ? rule.byDay : [day],
    ends: rule.count ? "count" : rule.until ? "until" : "never",
    count: rule.count ?? 10,
    until: rule.until
      ? "day" in rule.until
        ? rule.until.day
        : rule.until.at.toISOString().slice(0, 10)
      : "",
  };
}

/** RRULE text for the picker's state, or null for "does not repeat". */
export function rruleFromDraft(d: RepeatDraft): string | null {
  if (d.freq === "none") return null;
  const weekdays = d.freq === "WEEKDAYS";
  return formatRrule({
    freq: weekdays ? "WEEKLY" : (d.freq as Frequency),
    interval: weekdays ? 1 : Math.min(99, Math.max(1, d.interval || 1)),
    byDay: weekdays ? [1, 2, 3, 4, 5] : d.freq === "WEEKLY" ? d.byDay : [],
    count: d.ends === "count" ? Math.min(999, Math.max(1, d.count || 1)) : null,
    until: d.ends === "until" && d.until ? d.until : null,
  });
}

// ---- Calendar helpers ----------------------------------------------------------

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

/** "9:00 AM – 10:30 AM". */
export const spanLabel = (start: string, end: string) =>
  `${new Date(start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${new Date(
    end,
  ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

/** "YYYY-MM-DD" for a local date. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A local Date for a "YYYY-MM-DD" key. */
export const fromDayKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Blocks grouped by local day, in order. */
export function byDay<T extends Pick<TimeBlock | PlannedBlock, "start_at">>(
  blocks: T[],
) {
  const groups = new Map<string, T[]>();
  for (const b of [...blocks].sort((a, c) =>
    a.start_at.localeCompare(c.start_at),
  )) {
    const key = dayKey(new Date(b.start_at));
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return [...groups.entries()];
}

/** "Tuesday, 15 Sep" for a day key. */
export const longDay = (key: string) =>
  fromDayKey(key).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

/** A short label for a time zone at an instant, like "PST" or "GMT+10". */
export function zoneAbbr(zone: string, at = new Date()) {
  try {
    return (
      new Intl.DateTimeFormat([], { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? zone
    );
  } catch {
    return zone;
  }
}

/** "5 PM", or "5:30 PM" for zones off the hour, at `at` in `zone`. */
export function clockIn(zone: string, at: Date) {
  const { minute } = zonedParts(at, zone);
  return at.toLocaleTimeString([], {
    hour: "numeric",
    ...(minute ? { minute: "2-digit" } : {}),
    timeZone: zone,
  });
}

// ---- Misc ------------------------------------------------------------------------

/** Copy to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A readable message for a failed request (see lib/errors.ts). */
export { errorText } from "./errors";

/** Colours offered for lists, tags and frames (all readable on white). */
export const SWATCHES = [
  "#376c51",
  "#6d8a6f",
  "#4f7aa8",
  "#8a6bb0",
  "#b0573b",
  "#c28c30",
  "#3f8f8a",
  "#7a857e",
];

export const plural = (n: number, one: string, many = one + "s") =>
  `${n} ${n === 1 ? one : many}`;
