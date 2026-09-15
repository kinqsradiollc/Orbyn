import {
  addDays,
  clockMinutes,
  dayTime,
  localDateKey,
  offsetMinutes,
  weekdayOf,
  type BookingPage,
  type BusyInterval,
  type DateOverride,
  type PlannerPrefs,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import {
  busyIntervals,
  loadPrefs,
  mergeIntervals,
} from "../planner/calendar.js";
import { freeSpans, workingSpans } from "../planner/plans.js";

/**
 * When a booking page can offer times. Hosts' calendars never leave this
 * module: callers get free start times and nothing else.
 */
export type PageRow = Omit<BookingPage, "counts"> & {
  counts?: BookingPage["counts"];
};

type Span = { start: number; end: number };

const MINUTE = 60_000;
const DAY = 86_400_000;
const MAX_SLOTS = 400;

/** The page's time zone: its own hours' zone, or the owner's. */
export async function pageTimeZone(db: Queryable, page: PageRow) {
  return page.availability.mode === "custom"
    ? page.availability.timezone
    : (await loadPrefs(db, page.owner_id)).timezone;
}

const clip = (s: Span, from: number, to: number): Span | null => {
  const start = Math.max(s.start, from);
  const end = Math.min(s.end, to);
  return end > start ? { start, end } : null;
};

function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

const range = (day: string, start: string, end: string, tz: string): Span => ({
  start: dayTime(day, clockMinutes(start), tz).getTime(),
  end: dayTime(day, clockMinutes(end), tz).getTime(),
});

/** Every local day touching [from, to) in `tz`. */
function daysBetween(from: number, to: number, tz: string) {
  const days: string[] = [];
  const last = localDateKey(new Date(to), tz);
  for (let d = localDateKey(new Date(from), tz); d <= last; d = addDays(d, 1))
    days.push(d);
  return days;
}

/** The page's own weekly hours, with its date overrides. */
function customSpans(
  weekly: { day: number; start: string; end: string }[],
  overrides: DateOverride[],
  tz: string,
  from: number,
  to: number,
): Span[] {
  const spans: Span[] = [];
  for (const day of daysBetween(from, to, tz)) {
    const override = overrides.find((o) => o.date === day);
    const hours = override
      ? override.hours
      : weekly.filter((w) => w.day === weekdayOf(day));
    for (const h of hours) {
      const s = clip(range(day, h.start, h.end, tz), from, to);
      if (s) spans.push(s);
    }
  }
  return merge(spans);
}

/** A host's working hours, with the page's date overrides laid over them. */
function hostSpans(
  prefs: PlannerPrefs,
  overrides: DateOverride[],
  tz: string,
  from: number,
  to: number,
): Span[] {
  let spans: Span[] = workingSpans(prefs, new Date(from), new Date(to));
  for (const o of overrides) {
    const dayStart = dayTime(o.date, 0, tz).getTime();
    const dayEnd = dayTime(addDays(o.date, 1), 0, tz).getTime();
    if (dayEnd <= from || dayStart >= to) continue;
    spans = spans.flatMap((s) => {
      if (s.end <= dayStart || s.start >= dayEnd) return [s];
      const parts: Span[] = [];
      if (s.start < dayStart) parts.push({ start: s.start, end: dayStart });
      if (s.end > dayEnd) parts.push({ start: dayEnd, end: s.end });
      return parts;
    });
    for (const h of o.hours) {
      const s = clip(range(o.date, h.start, h.end, tz), from, to);
      if (s) spans.push(s);
    }
  }
  return merge(spans);
}

export function intersect(a: Span[], b: Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}

/** The Monday a "YYYY-MM-DD" day's week starts on. */
const weekOf = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));

export type SlotOptions = {
  now?: Date;
  /** The booking being moved: its hold and events don't block its new time. */
  ignoreBookingId?: string;
  ignoreItemIds?: string[];
};

/**
 * Free start times for a page between `from` and `to`: the page's hours
 * (its own weekly hours or each host's working hours, with date overrides)
 * that every required host has free, keeping the page's buffers before and
 * after, its notice period and window, and its daily and weekly limits.
 * Events, buffers, travel, time blocks and other bookings' holds count as
 * busy. Start times step by the page's interval from local midnight.
 */
export async function availableSlots(
  db: Queryable,
  page: PageRow,
  duration: number,
  from: Date,
  to: Date,
  options: SlotOptions = {},
): Promise<BusyInterval[]> {
  const now = (options.now ?? new Date()).getTime();
  const earliest = Math.max(
    from.getTime(),
    now + page.min_notice_minutes * MINUTE,
  );
  const latest = Math.min(to.getTime(), now + page.window_days * DAY);
  if (latest <= earliest) return [];
  const required = page.hosts.filter((h) => h.required).map((h) => h.user_id);
  const before = page.buffer_before_minutes * MINUTE;
  const after = page.buffer_after_minutes * MINUTE;
  const tz = await pageTimeZone(db, page);
  const holds = (
    await db.query<{ start_at: Date; end_at: Date }>(
      `SELECT b.start_at, b.end_at FROM bookings b
       WHERE b.page_id IN (SELECT page_id FROM booking_hosts WHERE user_id = ANY ($1::uuid[]))
         AND b.status IN ('pending', 'awaiting_approval') AND b.hold_until > now()
         AND b.start_at < $3 AND b.end_at > $2 AND b.id IS DISTINCT FROM $4::uuid`,
      [
        required,
        new Date(earliest - DAY),
        new Date(latest + DAY),
        options.ignoreBookingId ?? null,
      ],
    )
  ).rows.map((h) => ({
    start_at: h.start_at.toISOString(),
    end_at: h.end_at.toISOString(),
  }));

  // Busy time just outside the range still matters because of the buffers.
  const pad = before + after + 60 * MINUTE;
  let common: Span[] | null = null;
  for (const host of required) {
    const prefs = await loadPrefs(db, host);
    const busy = await busyIntervals(
      db,
      host,
      new Date(earliest - pad),
      new Date(latest + pad),
      { blocks: true, derived: true, excludeItemIds: options.ignoreItemIds },
    );
    // A booking needs `before` free ahead of it and `after` free behind it.
    const grown = [...busy, ...holds].map((b) => ({
      start_at: new Date(Date.parse(b.start_at) - after).toISOString(),
      end_at: new Date(Date.parse(b.end_at) + before).toISOString(),
    }));
    const windows =
      page.availability.mode === "custom"
        ? customSpans(
            page.availability.weekly,
            page.date_overrides,
            tz,
            earliest,
            latest,
          )
        : hostSpans(prefs, page.date_overrides, tz, earliest, latest);
    const free = freeSpans(windows, mergeIntervals(grown));
    common = common ? intersect(common, free) : free;
  }
  if (!common?.length) return [];

  // Daily and weekly limits count bookings on the page's local days.
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  if (page.max_per_day || page.max_per_week) {
    const taken = (
      await db.query<{ start_at: Date }>(
        `SELECT start_at FROM bookings
         WHERE page_id = $1 AND start_at >= $2 AND start_at < $3
           AND (status = 'confirmed'
             OR (status IN ('pending', 'awaiting_approval') AND hold_until > now()))
           AND id IS DISTINCT FROM $4::uuid`,
        [
          page.id,
          new Date(earliest - 8 * DAY),
          new Date(latest + 8 * DAY),
          options.ignoreBookingId ?? null,
        ],
      )
    ).rows;
    for (const t of taken) {
      const day = localDateKey(t.start_at, tz);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      perWeek.set(weekOf(day), (perWeek.get(weekOf(day)) ?? 0) + 1);
    }
  }

  const step = page.slot_interval_minutes * MINUTE;
  const need = duration * MINUTE;
  // The first start at or after `ms` that sits on the interval from local midnight.
  const aligned = (ms: number) => {
    const offset = offsetMinutes(tz, new Date(ms)) * MINUTE;
    return Math.ceil((ms + offset) / step) * step - offset;
  };
  const slots: BusyInterval[] = [];
  for (const span of common) {
    for (
      let at = aligned(span.start);
      at + need <= span.end && slots.length < MAX_SLOTS;
      at += step
    ) {
      const day = localDateKey(new Date(at), tz);
      if (page.max_per_day && (perDay.get(day) ?? 0) >= page.max_per_day)
        continue;
      if (
        page.max_per_week &&
        (perWeek.get(weekOf(day)) ?? 0) >= page.max_per_week
      )
        continue;
      slots.push({
        start_at: new Date(at).toISOString(),
        end_at: new Date(at + need).toISOString(),
      });
    }
  }
  return slots;
}
