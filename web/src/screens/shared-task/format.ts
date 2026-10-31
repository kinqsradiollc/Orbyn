import {
  dueBeforeToday,
  dueDayAt,
  formatRrule,
  isClosed,
  latestDates,
  parseRrule,
  priorityScore,
  STATUSES,
  taskSize,
  type Frequency,
  type Item,
  type Status,
} from "@orbyn/core";

export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** "45 min", "1 h", "1 h 30 min". */
export function minutesLabel(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export const ESTIMATES = [15, 30, 45, 60, 90, 120];

/** Colours offered for lists, tags and events; all readable on white. */
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
export const SWATCH_NAMES = [
  "Green",
  "Sage",
  "Blue",
  "Purple",
  "Rust",
  "Amber",
  "Teal",
  "Slate",
];

export const progressOf = (i: Pick<Item, "status" | "progress">) =>
  i.status === "done" ? 100 : Math.max(0, Math.min(100, i.progress ?? 0));

export const isOverdue = (i: Item, now = new Date()) =>
  !isClosed(i.status) && dueBeforeToday(i, now);

/** "just now", "5m ago", "2h ago", "3d ago", then a short date. */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** "Today", "Tomorrow", "Fri", "12 Nov" and the time when it has one. */
export function shortDue(
  item: Pick<Item, "due_at" | "all_day">,
  now = new Date(),
) {
  if (!item.due_at) return "";
  const at = new Date(item.due_at);
  const midnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(now)) / 86_400_000);
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : days > 1 && days < 7
            ? at.toLocaleDateString([], { weekday: "short" })
            : at.toLocaleDateString([], {
                day: "numeric",
                month: "short",
                ...(at.getFullYear() === now.getFullYear()
                  ? {}
                  : { year: "numeric" }),
              });
  if (item.all_day || (Math.abs(days) > 1 && days !== 0)) return day;
  return `${day} ${at.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export type DueFilter =
  "any" | "overdue" | "today" | "tomorrow" | "soon" | "week" | "none";

/** "today" is planned or due: `plannedToday` holds tasks with a session today. */
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
  const at = dueDayAt(i)!;
  const day = (n: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const within = (from: number, to: number) => at >= day(from) && at < day(to);
  if (due === "today") return within(0, 1);
  if (due === "tomorrow") return within(1, 2);
  if (due === "soon") return within(2, 7);
  return within(0, 7 - now.getDay());
}

/** Open first, most pressing first, counting each task's latest date. */
export function byScore(now = new Date(), among?: Item[]) {
  const latest = among ? latestDates(among) : null;
  const score = (i: Item) =>
    priorityScore(
      latest?.has(i.id) ? { ...i, deadline_at: latest.get(i.id) } : i,
      now,
    );
  return (a: Item, b: Item) =>
    Number(isClosed(a.status)) - Number(isClosed(b.status)) ||
    score(b) - score(a) ||
    a.title.localeCompare(b.title);
}

export const nextUp = (items: Item[], exclude?: string, limit = 5) =>
  items
    .filter((i) => i.kind === "task" && !isClosed(i.status) && i.id !== exclude)
    .sort(byScore(new Date(), items))
    .slice(0, limit);

export const sizeOf = taskSize;

export function statusCounts(items: Item[]) {
  const counts = { all: items.length } as Record<Status | "all", number>;
  for (const s of STATUSES) counts[s] = 0;
  for (const i of items) counts[i.status] += 1;
  return counts;
}

export function timeFact(i: Item) {
  const spent = i.spent_minutes ?? 0;
  if (!i.estimate_minutes && !spent) return null;
  if (!i.estimate_minutes) return `${minutesLabel(spent)} spent`;
  return spent
    ? `${minutesLabel(spent)} of ${minutesLabel(i.estimate_minutes)}`
    : minutesLabel(i.estimate_minutes);
}

export function alertLabel(minutes: number) {
  if (minutes === 0) return "At the time";
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, "day")} before`;
  if (minutes % 60 === 0) return `${plural(minutes / 60, "hour")} before`;
  return `${minutes} min before`;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// Repeating items.
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

/** The number fields of a repeat that can't be saved yet, in words. */
export function repeatProblem(d: RepeatDraft) {
  const whole = (n: number, max: number) =>
    Number.isInteger(n) && n >= 1 && n <= max;
  if (
    ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(d.freq) &&
    !whole(d.interval, 99)
  )
    return "Use a whole repeat interval from 1 to 99.";
  if (d.freq !== "none" && d.ends === "count" && !whole(d.count, 999))
    return "Use a whole repeat count from 1 to 999.";
  if (d.freq !== "none" && d.ends === "until" && !d.until)
    return "Pick the last date, or choose another ending.";
  return null;
}
