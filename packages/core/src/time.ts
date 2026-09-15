/**
 * Time zones, repeating items and task priority, shared by the server and the
 * apps. Everything here is pure: no clock, no network.
 */

/** Whether `timeZone` is an IANA zone this runtime knows. */
export function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = partsFormat.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormat.set(timeZone, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

/** The wall-clock date and time of `at` in `timeZone`. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(at))
    parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** Minutes `timeZone` is ahead of UTC at the instant `at` (Melbourne: 600 or 660). */
export function offsetMinutes(timeZone: string, at: Date) {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * The instant a wall-clock time happens in `timeZone`. A time skipped by a
 * daylight-saving jump moves forward by the jump; a repeated one takes the
 * first occurrence.
 */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMinutes(timeZone, new Date(guess));
  let at = guess - first * 60000;
  const second = offsetMinutes(timeZone, new Date(at));
  if (second !== first) at = guess - second * 60000;
  return new Date(at);
}

/** "2026-09-18" for the day `at` falls on in `timeZone`. */
export function localDateKey(at: Date, timeZone: string) {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" keys, independent of any zone. */
export function addDays(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** The weekday (0 = Sunday) of a "YYYY-MM-DD" key. */
export const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** The instant a "YYYY-MM-DD" day starts, plus `minutes`, in `timeZone`. */
export function dayTime(key: string, minutes: number, timeZone: string) {
  const [y, m, d] = key.split("-").map(Number);
  return zonedInstant(
    y,
    m,
    d,
    Math.floor(minutes / 60),
    minutes % 60,
    timeZone,
  );
}

/** Whether `at` is midnight (the start of a day) in `timeZone`. */
export function isLocalMidnight(at: Date, timeZone: string) {
  return (
    dayTime(localDateKey(at, timeZone), 0, timeZone).getTime() === at.getTime()
  );
}

/** Whole days from the local day of `start` to that of `end`, in `timeZone`. */
export function localDaysBetween(start: Date, end: Date, timeZone: string) {
  const [a, b] = [localDateKey(start, timeZone), localDateKey(end, timeZone)];
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** "09:30" -> 570. */
export const clockMinutes = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
};

// ---- Repeating items -------------------------------------------------------

export const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
const BYDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** The subset of RFC 5545 RRULE Orbyn understands. */
export type Rule = {
  freq: Frequency;
  interval: number;
  /** Weekdays for WEEKLY and MONTHLY rules, 0 = Sunday. */
  byDay: number[];
  /**
   * Days of the month for MONTHLY and YEARLY rules; negative counts from the
   * end (-1 is the last day). Always set by `parseRrule`.
   */
  byMonthDay?: number[];
  /**
   * Which of a month's matching days to keep (1 = first, -1 = last), with
   * BYDAY or BYMONTHDAY: "last weekday of the month" is
   * `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`. Always set by `parseRrule`.
   */
  bySetPos?: number[];
  count: number | null;
  /** Last allowed day ("YYYY-MM-DD") or instant. */
  until: { day: string } | { at: Date } | null;
};

/** "-1,15" -> [-1, 15] when every value is a non-zero integer up to `max`. */
function signedList(value: string, max: number): number[] | null {
  const out: number[] = [];
  for (const part of value.split(",")) {
    if (!/^[+-]?\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!n || Math.abs(n) > max) return null;
    out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Parse "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10", or null when it isn't one we support. */
export function parseRrule(text: string): Rule | null {
  const rule: Rule = {
    freq: "DAILY",
    interval: 1,
    byDay: [],
    byMonthDay: [],
    bySetPos: [],
    count: null,
    until: null,
  };
  let freq = false;
  for (const part of text
    .trim()
    .replace(/^RRULE:/i, "")
    .split(";")) {
    if (!part) continue;
    const [key, value] = part.split("=");
    if (!value) return null;
    switch (key.toUpperCase()) {
      case "FREQ":
        if (!(FREQUENCIES as readonly string[]).includes(value)) return null;
        rule.freq = value as Frequency;
        freq = true;
        break;
      case "INTERVAL":
        if (!/^[1-9]\d?$/.test(value)) return null;
        rule.interval = Number(value);
        break;
      case "BYDAY": {
        const days = value
          .split(",")
          .map((d) =>
            (BYDAY_CODES as readonly string[]).indexOf(d.toUpperCase()),
          );
        if (days.some((d) => d < 0) || days.length > 7) return null;
        rule.byDay = [...new Set(days)].sort((a, b) => a - b);
        break;
      }
      case "BYMONTHDAY": {
        const days = signedList(value, 31);
        if (!days) return null;
        rule.byMonthDay = days;
        break;
      }
      case "BYSETPOS": {
        const positions = signedList(value, 366);
        if (!positions) return null;
        rule.bySetPos = positions;
        break;
      }
      case "COUNT":
        if (!/^[1-9]\d{0,2}$/.test(value)) return null;
        rule.count = Number(value);
        break;
      case "UNTIL": {
        const m = value.match(
          /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/,
        );
        if (!m) return null;
        rule.until = m[4]
          ? {
              at: new Date(
                Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
              ),
            }
          : { day: `${m[1]}-${m[2]}-${m[3]}` };
        break;
      }
      default:
        return null;
    }
  }
  if (!freq || (rule.count && rule.until)) return null;
  const monthDays = rule.byMonthDay!.length > 0;
  if (rule.byDay.length && rule.freq !== "WEEKLY" && rule.freq !== "MONTHLY")
    return null;
  if (monthDays && rule.freq !== "MONTHLY" && rule.freq !== "YEARLY")
    return null;
  // Weekdays and month days together would need their intersection; not supported.
  if (monthDays && rule.byDay.length) return null;
  if (
    rule.bySetPos!.length &&
    (rule.freq !== "MONTHLY" || (!monthDays && !rule.byDay.length))
  )
    return null;
  return rule;
}

export const isValidRrule = (text: string) => parseRrule(text) !== null;

/** Build the RRULE text for a rule (the inverse of `parseRrule`). */
export function formatRrule(
  rule: Omit<Rule, "until"> & { until?: string | null },
) {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if ((rule.freq === "WEEKLY" || rule.freq === "MONTHLY") && rule.byDay.length)
    parts.push(`BYDAY=${rule.byDay.map((d) => BYDAY_CODES[d]).join(",")}`);
  if (rule.byMonthDay?.length)
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.bySetPos?.length) parts.push(`BYSETPOS=${rule.bySetPos.join(",")}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  return parts.join(";");
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 1 -> "1st", -1 -> "last", -2 -> "2nd-last". */
function ordinal(n: number) {
  if (n === -1) return "last";
  const k = Math.abs(n);
  const suffix =
    k % 100 >= 11 && k % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][k % 10] ?? "th");
  return n < 0 ? `${k}${suffix}-last` : `${k}${suffix}`;
}

/** "Every 2 weeks on Mon, Wed · 10 times", for labels. */
export function describeRrule(text: string | null | undefined) {
  if (!text) return "";
  const rule = parseRrule(text);
  if (!rule) return "Repeats";
  const unit = {
    DAILY: "day",
    WEEKLY: "week",
    MONTHLY: "month",
    YEARLY: "year",
  }[rule.freq];
  let label =
    rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.freq === "DAILY" && rule.interval === 1) label = "Every day";
  const positions = (rule.bySetPos ?? []).map(ordinal).join(", ");
  if (rule.byMonthDay?.length) {
    const days = rule.byMonthDay
      .map((d) =>
        d === -1
          ? "the last day"
          : d < 0
            ? `the ${ordinal(d)} day`
            : `day ${d}`,
      )
      .join(", ");
    label += positions ? ` on the ${positions} of ${days}` : ` on ${days}`;
  } else if (rule.byDay.length) {
    const days = rule.byDay.join(",");
    const names =
      days === "1,2,3,4,5"
        ? "weekday"
        : rule.byDay.map((d) => DAY_NAMES[d]).join(", ");
    if (rule.freq === "MONTHLY")
      label += positions ? ` on the ${positions} ${names}` : ` on ${names}s`;
    else if (days === "1,2,3,4,5" && rule.interval === 1)
      label = "Every weekday";
    else label += ` on ${rule.byDay.map((d) => DAY_NAMES[d]).join(", ")}`;
  }
  if (rule.count) label += ` · ${rule.count} times`;
  if (rule.until)
    label += ` · until ${"day" in rule.until ? rule.until.day : rule.until.at.toISOString().slice(0, 10)}`;
  return label;
}

const MAX_STEPS = 5000;

/**
 * Every occurrence of a series in order, starting at `start` itself. The
 * wall-clock time is kept across daylight-saving changes. Honors COUNT and
 * UNTIL; exceptions are the caller's to skip.
 */
export function* occurrences(
  start: Date,
  rule: Rule,
  timeZone: string,
): Generator<Date> {
  const s = zonedParts(start, timeZone);
  const startKey = localDateKey(start, timeZone);
  const untilAt =
    rule.until && "at" in rule.until
      ? rule.until.at.getTime()
      : rule.until
        ? dayTime(addDays(rule.until.day, 1), 0, timeZone).getTime() - 1
        : Infinity;
  let emitted = 0;
  const emit = (key: string): Date | null => {
    const [y, m, d] = key.split("-").map(Number);
    const at = zonedInstant(y, m, d, s.hour, s.minute, timeZone);
    if (at.getTime() > untilAt) return null;
    return at;
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const keys: string[] = [];
    if (rule.freq === "DAILY")
      keys.push(addDays(startKey, step * rule.interval));
    else if (rule.freq === "WEEKLY") {
      const days = rule.byDay.length ? rule.byDay : [s.weekday];
      // Weeks start on Monday, as in RFC 5545's default WKST.
      const monday = addDays(
        startKey,
        -((s.weekday + 6) % 7) + step * 7 * rule.interval,
      );
      for (const d of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const key = addDays(monday, (d + 6) % 7);
        if (key >= startKey) keys.push(key);
      }
    } else {
      const months =
        rule.freq === "MONTHLY"
          ? step * rule.interval
          : step * rule.interval * 12;
      const total = s.month - 1 + months;
      const y = s.year + Math.floor(total / 12);
      const m = (total % 12) + 1;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let days: number[];
      if (rule.byMonthDay?.length)
        // Negative days count from the end: -1 is the last day of this month.
        days = rule.byMonthDay
          .map((d) => (d > 0 ? d : last + 1 + d))
          .filter((d) => d >= 1 && d <= last);
      else if (rule.byDay.length) {
        days = [];
        for (let d = 1; d <= last; d++)
          if (rule.byDay.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay()))
            days.push(d);
      }
      // A month without the day (the 31st, 29 February) has no occurrence.
      else days = s.day <= last ? [s.day] : [];
      days = [...new Set(days)].sort((a, b) => a - b);
      if (rule.bySetPos?.length) {
        const all = days;
        days = [
          ...new Set(
            rule.bySetPos
              .map((p) => (p > 0 ? all[p - 1] : all[all.length + p]))
              .filter((d): d is number => d !== undefined),
          ),
        ].sort((a, b) => a - b);
      }
      for (const d of days) {
        const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (key >= startKey) keys.push(key);
      }
    }
    for (const key of keys) {
      const at = emit(key);
      if (!at) return;
      yield at;
      emitted++;
      if (rule.count && emitted >= rule.count) return;
    }
  }
}

/** Occurrences inside [from, to), skipping removed ones. */
export function occurrencesBetween(
  start: Date,
  rrule: string,
  timeZone: string,
  from: Date,
  to: Date,
  exdates: (string | Date)[] = [],
  limit = 500,
): Date[] {
  const rule = parseRrule(rrule);
  if (!rule) return start >= from && start < to ? [start] : [];
  const skip = new Set(exdates.map((d) => new Date(d).getTime()));
  const out: Date[] = [];
  for (const at of occurrences(start, rule, timeZone)) {
    if (at >= to) break;
    if (at >= from && !skip.has(at.getTime())) out.push(at);
    if (out.length >= limit) break;
  }
  return out;
}

/** The first occurrence strictly after `after`, or null when the series has ended. */
export function nextOccurrence(
  start: Date,
  rrule: string,
  timeZone: string,
  after: Date,
  exdates: (string | Date)[] = [],
): Date | null {
  const rule = parseRrule(rrule);
  if (!rule) return null;
  const skip = new Set(exdates.map((d) => new Date(d).getTime()));
  for (const at of occurrences(start, rule, timeZone))
    if (at > after && !skip.has(at.getTime())) return at;
  return null;
}

// ---- Priority --------------------------------------------------------------

const PRIORITY_WEIGHT = { low: 1, medium: 2, high: 3 } as const;

/** `size_fit` values: the estimate fits today's largest free slot, doesn't, or is unknown. */
export const SIZE_FIT = { fits: 1, too_big: 0.5, unknown: 0.75 } as const;

/**
 * How well a task's remaining estimate fits the largest free slot today: 1
 * when it fits in one go, 0.5 when it doesn't, and a neutral 0.75 for a task
 * without an estimate.
 */
export function sizeFit(
  item: { estimate_minutes?: number | null; spent_minutes?: number | null },
  largestFreeMinutes: number,
) {
  if (item.estimate_minutes == null) return SIZE_FIT.unknown;
  const remaining = Math.max(
    0,
    item.estimate_minutes - (item.spent_minutes ?? 0),
  );
  return remaining <= largestFreeMinutes ? SIZE_FIT.fits : SIZE_FIT.too_big;
}

/**
 * How pressing an open task is, used to sort lists and by the planner:
 *
 *   3 x priority (1-3) + 4 x urgency + 2 if overdue + 1 x size_fit
 *
 * Urgency rises from 0 a week before the due time to 1 at it. `size_fit`
 * (see `sizeFit`) is 1 when the remaining estimate fits the largest free slot
 * today, 0.5 when it doesn't and 0.75 without an estimate, so quick wins that
 * fit edge ahead of equal work that can't be done in one sitting. It only
 * counts when the caller knows the largest free slot (`largestFreeMinutes`);
 * the planner and task lists always pass it. Blocked tasks sink; tasks
 * already under way rise a little.
 */
export function priorityScore(
  item: {
    priority: "low" | "medium" | "high";
    status: string;
    due_at: string | null;
    estimate_minutes?: number | null;
    spent_minutes?: number | null;
  },
  now = new Date(),
  largestFreeMinutes?: number | null,
) {
  const due = item.due_at ? Date.parse(item.due_at) : NaN;
  const hours = Number.isNaN(due)
    ? Infinity
    : (due - now.getTime()) / 3_600_000;
  const urgency = Number.isFinite(hours)
    ? Math.min(1, Math.max(0, 1 - hours / (7 * 24)))
    : 0;
  let score = 3 * PRIORITY_WEIGHT[item.priority] + 4 * urgency;
  if (hours < 0) score += 2;
  if (largestFreeMinutes != null) score += sizeFit(item, largestFreeMinutes);
  if (item.status === "in_progress") score += 0.5;
  if (item.status === "blocked") score -= 3;
  return Math.round(score * 100) / 100;
}
