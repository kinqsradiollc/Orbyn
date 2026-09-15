import {
  occurrencesBetween,
  type BusyInterval,
  type CalendarEntry,
  type DerivedBlock,
  type Place,
  type PlannerPrefs,
  type TimeBlock,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import { frameSpans, loadFrames } from "./frames.js";

/** An event without an end still takes this long on the calendar. */
export const DEFAULT_EVENT_MINUTES = 30;

export const DEFAULT_PREFS: PlannerPrefs = {
  timezone: "UTC",
  work_days: [1, 2, 3, 4, 5],
  work_start: "09:00",
  work_end: "17:00",
  pad_percent: 20,
  split_after_minutes: 90,
  min_block_minutes: 25,
  break_level: "normal",
  horizon_days: 1,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  adaptive_buffers: false,
  default_travel_minutes: 0,
  extra_timezones: [],
  calendar_sets: [],
  pinned_user_ids: [],
  deadline_notice_days: 1,
  planner_notices: { push: true, email: false },
};

type PrefsRow = Omit<PlannerPrefs, "work_start" | "work_end"> & {
  work_start: string;
  work_end: string;
};

/** Someone's planning preferences, with defaults when they haven't set any. */
export async function loadPrefs(db: Db, userId: string): Promise<PlannerPrefs> {
  const row = (
    await db.query<PrefsRow>("SELECT * FROM planner_prefs WHERE user_id = $1", [
      userId,
    ])
  ).rows[0];
  if (!row) return { ...DEFAULT_PREFS };
  return {
    timezone: row.timezone,
    work_days: row.work_days.map(Number),
    work_start: String(row.work_start).slice(0, 5),
    work_end: String(row.work_end).slice(0, 5),
    pad_percent: row.pad_percent,
    split_after_minutes: row.split_after_minutes,
    min_block_minutes: row.min_block_minutes,
    break_level: row.break_level,
    horizon_days: row.horizon_days,
    buffer_before_minutes: row.buffer_before_minutes,
    buffer_after_minutes: row.buffer_after_minutes,
    adaptive_buffers: row.adaptive_buffers,
    default_travel_minutes: row.default_travel_minutes,
    extra_timezones: row.extra_timezones,
    calendar_sets: row.calendar_sets,
    pinned_user_ids: row.pinned_user_ids,
    deadline_notice_days: row.deadline_notice_days,
    planner_notices: {
      ...DEFAULT_PREFS.planner_notices!,
      ...row.planner_notices,
    },
  };
}

export async function loadPlaces(db: Db, userId: string): Promise<Place[]> {
  return (
    await db.query<Place>(
      "SELECT id, label, match, travel_minutes FROM places WHERE user_id = $1 ORDER BY label",
      [userId],
    )
  ).rows;
}

type EntryRow = {
  id: string;
  title: string;
  kind: CalendarEntry["kind"];
  status: CalendarEntry["status"];
  priority: CalendarEntry["priority"];
  due_at: Date;
  end_at: Date | null;
  team_id: string | null;
  team_name: string | null;
  list_id: string | null;
  location: string;
  meeting_url: string;
  rrule: string | null;
  timezone: string;
  series_start: Date | null;
  exdates: Date[];
  version: number;
};

/**
 * Every occurrence of the items `userId` can see that overlaps [from, to):
 * one entry per occurrence for repeating items. A repeating task shows from
 * its current occurrence on; a repeating event shows its whole series.
 */
export async function calendarEntries(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<CalendarEntry[]> {
  const rows = (
    await db.query<EntryRow>(
      `SELECT i.id, i.title, i.kind, i.status, i.priority, i.due_at, i.end_at,
              i.team_id, t.name AS team_name, i.list_id, i.location, i.meeting_url,
              i.rrule, i.timezone, i.series_start, i.exdates, i.version
       FROM items i LEFT JOIN teams t ON t.id = i.team_id
       WHERE ${VISIBLE_ITEMS} AND i.due_at IS NOT NULL AND (
         (i.rrule IS NULL AND i.due_at < $3 AND coalesce(i.end_at, i.due_at) >= $2)
         OR (i.rrule IS NOT NULL AND coalesce(i.series_start, i.due_at) < $3)
       )
       ORDER BY i.due_at LIMIT 2000`,
      [userId, from, to],
    )
  ).rows;
  const entries: CalendarEntry[] = [];
  for (const r of rows) {
    const base = {
      item_id: r.id,
      title: r.title,
      kind: r.kind,
      status: r.status,
      priority: r.priority,
      team_id: r.team_id,
      team_name: r.team_name,
      list_id: r.list_id,
      location: r.location,
      meeting_url: r.meeting_url,
      rrule: r.rrule,
      version: r.version,
    };
    if (!r.rrule) {
      entries.push({
        ...base,
        start_at: r.due_at.toISOString(),
        end_at: r.end_at ? r.end_at.toISOString() : null,
        occurrence: null,
      });
      continue;
    }
    const length = r.end_at ? r.end_at.getTime() - r.due_at.getTime() : 0;
    // Tasks: finished occurrences were moved past, so start from the current one.
    const seriesStart = r.series_start ?? r.due_at;
    const shownFrom =
      r.kind === "task"
        ? new Date(Math.max(from.getTime(), r.due_at.getTime()))
        : new Date(from.getTime() - length);
    for (const at of occurrencesBetween(
      seriesStart,
      r.rrule,
      r.timezone,
      shownFrom,
      to,
      r.exdates,
    ))
      entries.push({
        ...base,
        // Only the current occurrence of a repeating task can be done.
        status:
          r.kind === "task" && at.getTime() !== r.due_at.getTime()
            ? "todo"
            : r.status,
        start_at: at.toISOString(),
        end_at: length ? new Date(at.getTime() + length).toISOString() : null,
        occurrence: at.toISOString(),
      });
  }
  return entries.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** Blocks `userId` set aside, for items they can still see. */
export async function timeBlocks(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<TimeBlock[]> {
  return (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.user_id = $1 AND b.start_at < $3 AND b.end_at > $2 AND ${VISIBLE_ITEMS}
       ORDER BY b.start_at`,
      [userId, from, to],
    )
  ).rows.map((b) => ({
    ...b,
    start_at: new Date(b.start_at).toISOString(),
    end_at: new Date(b.end_at).toISOString(),
  }));
}

const isLink = (location: string) => /^https?:\/\//i.test(location.trim());

/** Minutes each side of a meeting: fixed, or 5 per half hour up to 15. */
function bufferMinutes(prefs: PlannerPrefs, minutes: number) {
  if (prefs.adaptive_buffers) {
    const adaptive = Math.min(15, 5 * Math.ceil(minutes / 30));
    return { before: adaptive, after: adaptive };
  }
  return {
    before: prefs.buffer_before_minutes,
    after: prefs.buffer_after_minutes,
  };
}

/** How long it takes to reach a location, from the matching place or the default. */
export function travelMinutes(
  location: string,
  places: Place[],
  fallback: number,
): { minutes: number; label: string } | null {
  const text = location.trim();
  if (!text || isLink(text)) return null;
  const lower = text.toLowerCase();
  const place = places.find((p) =>
    lower.includes(p.match.trim().toLowerCase()),
  );
  if (place)
    return place.travel_minutes
      ? { minutes: place.travel_minutes, label: place.label }
      : null;
  return fallback ? { minutes: fallback, label: text } : null;
}

const overlaps = (a: BusyInterval, b: BusyInterval) =>
  a.start_at < b.end_at && b.start_at < a.end_at;

/**
 * Buffers and travel time around timed events, worked out from the owner's
 * preferences and places rather than stored, so they always follow the
 * events. Travel goes right before a located event, and back after the last
 * located event of the day; buffers go around meetings. Anything that would
 * run into another event is left out.
 */
export function derivedBlocks(
  entries: CalendarEntry[],
  prefs: PlannerPrefs,
  places: Place[],
  localDay: (at: string) => string,
): DerivedBlock[] {
  const events = entries.filter(
    (e) => e.kind === "event" && e.status !== "done" && e.end_at,
  );
  const busy = events.map((e) => ({ start_at: e.start_at, end_at: e.end_at! }));
  const out: DerivedBlock[] = [];
  const shift = (at: string, minutes: number) =>
    new Date(Date.parse(at) + minutes * 60000).toISOString();
  const lastLocated = new Map<string, CalendarEntry>();
  for (const e of events) {
    const minutes = (Date.parse(e.end_at!) - Date.parse(e.start_at)) / 60000;
    const travel = travelMinutes(
      e.location,
      places,
      prefs.default_travel_minutes,
    );
    const buffer = bufferMinutes(prefs, minutes);
    if (travel) {
      out.push({
        kind: "travel",
        item_id: e.item_id,
        start_at: shift(e.start_at, -travel.minutes),
        end_at: e.start_at,
        label: `Travel to ${travel.label}`,
      });
      lastLocated.set(localDay(e.start_at), e);
    } else if (buffer.before)
      out.push({
        kind: "buffer",
        item_id: e.item_id,
        start_at: shift(e.start_at, -buffer.before),
        end_at: e.start_at,
        label: "Buffer",
      });
    if (buffer.after)
      out.push({
        kind: "buffer",
        item_id: e.item_id,
        start_at: e.end_at!,
        end_at: shift(e.end_at!, buffer.after),
        label: "Buffer",
      });
  }
  for (const e of lastLocated.values()) {
    const travel = travelMinutes(
      e.location,
      places,
      prefs.default_travel_minutes,
    )!;
    const buffer = bufferMinutes(
      prefs,
      (Date.parse(e.end_at!) - Date.parse(e.start_at)) / 60000,
    ).after;
    out.push({
      kind: "travel",
      item_id: e.item_id,
      start_at: shift(e.end_at!, buffer),
      end_at: shift(e.end_at!, buffer + travel.minutes),
      label: "Travel back",
    });
  }
  return out
    .filter((d) => !busy.some((b) => overlaps(d, b)))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** Merge overlapping or touching intervals. */
export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = intervals
    .filter((i) => i.end_at > i.start_at)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const out: BusyInterval[] = [];
  for (const i of sorted) {
    const last = out.at(-1);
    if (last && i.start_at <= last.end_at) {
      if (i.end_at > last.end_at) last.end_at = i.end_at;
    } else out.push({ ...i });
  }
  return out;
}

export type BusyOptions = {
  /** Count time blocks as busy (the planner leaves out the plan it replaces). */
  blocks?: boolean;
  excludeBlockIds?: string[];
  /** Count buffers and travel as busy. */
  derived?: boolean;
  /** Leave these items out (a booking being moved ignores its own events). */
  excludeItemIds?: string[];
  /**
   * Count frames marked busy as busy. Booking pages and team time ask for
   * this; the planner never does, since it plans inside frames.
   */
  frames?: boolean;
};

/**
 * When `userId` is busy in [from, to): timed events, their buffers and
 * travel, and blocks already set aside. Task due times are deadlines, not
 * busy time. Only intervals leave this function, never titles.
 */
export async function busyIntervals(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  options: BusyOptions = { blocks: true, derived: true },
): Promise<BusyInterval[]> {
  const prefs = await loadPrefs(db, userId);
  // Look a little either side, so travel and buffers at the edges count.
  const pad = 4 * 3_600_000;
  const skip = new Set(options.excludeItemIds ?? []);
  const entries = (
    await calendarEntries(
      db,
      userId,
      new Date(from.getTime() - pad),
      new Date(to.getTime() + pad),
    )
  ).filter((e) => !skip.has(e.item_id));
  const events = entries.filter(
    (e) => e.kind === "event" && e.status !== "done",
  );
  const busy: BusyInterval[] = events.map((e) => ({
    start_at: e.start_at,
    end_at:
      e.end_at ??
      new Date(
        Date.parse(e.start_at) + DEFAULT_EVENT_MINUTES * 60000,
      ).toISOString(),
  }));
  if (options.derived) {
    const places = await loadPlaces(db, userId);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: prefs.timezone });
    busy.push(
      ...derivedBlocks(entries, prefs, places, (at) =>
        day.format(new Date(at)),
      ),
    );
  }
  if (options.blocks) {
    const exclude = new Set(options.excludeBlockIds ?? []);
    busy.push(
      ...(await timeBlocks(db, userId, from, to))
        .filter((b) => !exclude.has(b.id))
        .map((b) => ({ start_at: b.start_at, end_at: b.end_at })),
    );
  }
  if (options.frames)
    for (const f of await loadFrames(db, userId, true))
      for (const s of frameSpans(
        f,
        from.getTime(),
        to.getTime(),
        prefs.timezone,
      ))
        busy.push({
          start_at: new Date(s.start).toISOString(),
          end_at: new Date(s.end).toISOString(),
        });
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return mergeIntervals(busy)
    .filter((b) => b.end_at > fromIso && b.start_at < toIso)
    .map((b) => ({
      start_at: b.start_at < fromIso ? fromIso : b.start_at,
      end_at: b.end_at > toIso ? toIso : b.end_at,
    }));
}
