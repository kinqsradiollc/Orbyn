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
  type OpenInviteStatus,
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
  /** Set when this "page" stands for an open invite: its windows are its hours. */
  invite?: InviteRow;
};

/** An open invite as stored. */
export type InviteRow = {
  id: string;
  owner_id: string;
  title: string;
  duration: number;
  windows: BusyInterval[];
  location: string;
  meeting_url: string;
  co_host_ids: string[];
  remind_before_minutes: number[];
  status: OpenInviteStatus;
  expires_at: Date;
  booking_id: string | null;
  token_encrypted: string;
  created_at: Date;
};

/** Open invites offer start times on the quarter hour. */
const INVITE_STEP_MINUTES = 15;

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

/** Union of spans (for round-robin, where any host free means the slot is offered). */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
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
  /** Check only this host (a round-robin booking's assigned host). */
  assignedHost?: string;
};

/** Bookings still held (waiting for an email link or a host) on pages these people host. */
async function holdsFor(
  db: Queryable,
  hosts: string[],
  from: number,
  to: number,
  ignoreBookingId?: string,
): Promise<BusyInterval[]> {
  return (
    await db.query<{ start_at: Date; end_at: Date }>(
      `SELECT b.start_at, b.end_at FROM bookings b
       WHERE (b.assigned_user_id = ANY ($1::uuid[])
              OR (b.assigned_user_id IS NULL
                  AND b.page_id IN (SELECT page_id FROM booking_hosts WHERE user_id = ANY ($1::uuid[]))))
         AND b.status IN ('pending', 'awaiting_approval') AND b.hold_until > now()
         AND b.start_at < $3 AND b.end_at > $2 AND b.id IS DISTINCT FROM $4::uuid`,
      [hosts, new Date(from), new Date(to), ignoreBookingId ?? null],
    )
  ).rows.map((h) => ({
    start_at: h.start_at.toISOString(),
    end_at: h.end_at.toISOString(),
  }));
}

/**
 * Free start times inside an open invite's windows: every host (the owner
 * and co-hosts) must be free, and bookings still held count as busy. Start
 * times fall on the quarter hour in the owner's time zone.
 */
async function inviteSlots(
  db: Queryable,
  page: PageRow,
  duration: number,
  from: Date,
  to: Date,
  options: SlotOptions,
): Promise<BusyInterval[]> {
  const now = (options.now ?? new Date()).getTime();
  const earliest = Math.max(from.getTime(), now);
  const latest = to.getTime();
  if (latest <= earliest) return [];
  const windows = merge(
    page
      .invite!.windows.map((w) =>
        clip(
          { start: Date.parse(w.start_at), end: Date.parse(w.end_at) },
          earliest,
          latest,
        ),
      )
      .filter((s): s is Span => !!s),
  );
  if (!windows.length) return [];
  const hosts = page.hosts.map((h) => h.user_id);
  const holds = await holdsFor(
    db,
    hosts,
    earliest - DAY,
    latest + DAY,
    options.ignoreBookingId,
  );
  let common: Span[] | null = windows;
  for (const host of hosts) {
    const busy = await busyIntervals(
      db,
      host,
      new Date(earliest - 60 * MINUTE),
      new Date(latest + 60 * MINUTE),
      {
        blocks: true,
        derived: true,
        frames: true,
        excludeItemIds: options.ignoreItemIds,
      },
    );
    common = intersect(
      common!,
      freeSpans(windows, mergeIntervals([...busy, ...holds])),
    );
  }
  const tz = await pageTimeZone(db, page);
  return startTimes(common ?? [], INVITE_STEP_MINUTES, duration, tz);
}

/** Start times stepping by `step` minutes from local midnight, that fit `duration`. */
function startTimes(
  spans: Span[],
  step: number,
  duration: number,
  tz: string,
  accept: (at: number) => boolean = () => true,
): BusyInterval[] {
  const stepMs = step * MINUTE;
  const need = duration * MINUTE;
  // The first start at or after `ms` that sits on the interval from local midnight.
  const aligned = (ms: number) => {
    const offset = offsetMinutes(tz, new Date(ms)) * MINUTE;
    return Math.ceil((ms + offset) / stepMs) * stepMs - offset;
  };
  const slots: BusyInterval[] = [];
  for (const span of spans)
    for (
      let at = aligned(span.start);
      at + need <= span.end && slots.length < MAX_SLOTS;
      at += stepMs
    )
      if (accept(at))
        slots.push({
          start_at: new Date(at).toISOString(),
          end_at: new Date(at + need).toISOString(),
        });
  return slots;
}

/**
 * Free start times for a page between `from` and `to`: the page's hours
 * (its own weekly hours or each host's working hours, with date overrides)
 * that every required host has free, keeping the page's buffers before and
 * after, its notice period and window, and its daily and weekly limits.
 * Events, buffers, travel, time blocks and other bookings' holds count as
 * busy. Start times step by the page's interval from local midnight. An
 * open invite's times come from its windows instead (`inviteSlots`).
 */
export async function availableSlots(
  db: Queryable,
  page: PageRow,
  duration: number,
  from: Date,
  to: Date,
  options: SlotOptions = {},
): Promise<BusyInterval[]> {
  if (page.invite) return inviteSlots(db, page, duration, from, to, options);
  const now = (options.now ?? new Date()).getTime();
  const earliest = Math.max(
    from.getTime(),
    now + page.min_notice_minutes * MINUTE,
  );
  const latest = Math.min(to.getTime(), now + page.window_days * DAY);
  if (latest <= earliest) return [];
  // Who must be free, and how their free times combine. Round-robin offers a
  // slot when ANY host is free (union); collective needs every required host
  // (intersection). Checking one assigned host is a single-host intersection.
  const roundRobin = page.assignment === "round_robin" && !options.assignedHost;
  const candidates = options.assignedHost
    ? [options.assignedHost]
    : roundRobin
      ? page.hosts.map((h) => h.user_id)
      : page.hosts.filter((h) => h.required).map((h) => h.user_id);
  const required = candidates;
  const before = page.buffer_before_minutes * MINUTE;
  const after = page.buffer_after_minutes * MINUTE;
  const tz = await pageTimeZone(db, page);
  const holds = await holdsFor(
    db,
    required,
    earliest - DAY,
    latest + DAY,
    options.ignoreBookingId,
  );

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
      {
        blocks: true,
        derived: true,
        frames: true,
        excludeItemIds: options.ignoreItemIds,
      },
    );
    // Busy frames count, like events. A booking needs `before` free ahead of
    // it and `after` free behind it.
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
    common = common
      ? roundRobin
        ? mergeSpans([...common, ...free])
        : intersect(common, free)
      : free;
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

  return startTimes(common, page.slot_interval_minutes, duration, tz, (at) => {
    const day = localDateKey(new Date(at), tz);
    if (page.max_per_day && (perDay.get(day) ?? 0) >= page.max_per_day)
      return false;
    return !(
      page.max_per_week && (perWeek.get(weekOf(day)) ?? 0) >= page.max_per_week
    );
  });
}

/**
 * Which host a round-robin booking should go to: among the candidates free at
 * this exact slot, the one with the fewest bookings on the page (fairest),
 * breaking ties by the host order the page lists. Null when none is free.
 */
export async function chooseHost(
  db: Queryable,
  page: PageRow,
  duration: number,
  start: Date,
  end: Date,
  now = new Date(),
  preferred?: string,
): Promise<string | null> {
  // A routed host gets it when they're free; otherwise fall through to fair.
  if (preferred && page.hosts.some((h) => h.user_id === preferred)) {
    const free = await availableSlots(db, page, duration, start, end, {
      now,
      assignedHost: preferred,
    });
    if (free.some((f) => f.start_at === start.toISOString())) return preferred;
  }
  const counts = new Map<string, number>();
  for (const row of (
    await db.query<{ assigned_user_id: string | null; n: number }>(
      `SELECT assigned_user_id, count(*)::int AS n FROM bookings
         WHERE page_id = $1 AND assigned_user_id IS NOT NULL
           AND status IN ('confirmed', 'pending', 'awaiting_approval')
         GROUP BY assigned_user_id`,
      [page.id],
    )
  ).rows)
    if (row.assigned_user_id) counts.set(row.assigned_user_id, row.n);

  let best: string | null = null;
  let bestCount = Infinity;
  for (const host of page.hosts) {
    const free = await availableSlots(db, page, duration, start, end, {
      now,
      assignedHost: host.user_id,
    });
    if (!free.some((f) => f.start_at === start.toISOString())) continue;
    const c = counts.get(host.user_id) ?? 0;
    if (c < bestCount) {
      best = host.user_id;
      bestCount = c;
    }
  }
  return best;
}
