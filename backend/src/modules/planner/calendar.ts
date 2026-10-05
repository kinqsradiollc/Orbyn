import {
  addDays,
  dayTime,
  isClosed,
  localDateKey,
  localDaysBetween,
  occurrencesBetween,
  weekdayOf,
  type BufferScope,
  type BusyInterval,
  type AgendaEntry,
  type CalendarEntry,
  type DefaultAlerts,
  type DerivedBlock,
  type OccurrenceChanges,
  type Place,
  type PlannerPrefs,
  type TimeBlock,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { frameSpans, loadFrames } from "./frames.js";
import { externalEntries } from "./subscriptions.js";
import { visibleItems } from "../../lib/visibility.js";
import { visibleAiItems } from "../../lib/assistant-source-visibility.js";

/** Alerts new items get until someone chooses their own: 30 minutes before. */
export const DEFAULT_ALERTS: DefaultAlerts = {
  event: [30],
  task: [30],
  all_day: [30],
};

/** An entry that takes time: a timed event that isn't closed or marked free. */
export const blocksTime = (e: CalendarEntry) =>
  e.kind === "event" && !isClosed(e.status) && e.busy !== false && !e.all_day;

/** Every timed busy event gets buffers until someone narrows it. */
export const DEFAULT_BUFFER_SCOPE: BufferScope = {
  personal: true,
  team_ids: null,
  list_ids: [],
  min_minutes: 0,
  only_with_others: false,
};

/** An event without an end still takes this long on the calendar. */
export const DEFAULT_EVENT_MINUTES = 30;

/** Digests are opt-in: nobody is emailed a digest until they turn it on. */
export const DEFAULT_DIGEST = {
  morning: false,
  evening: false,
  morning_time: "07:00",
  evening_time: "17:00",
  // What agents did (in the morning digest) and a push for big jobs: on
  // unless turned off (H7).
  agents: true,
  agent_push: true,
};

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
  default_alerts: DEFAULT_ALERTS,
  count_blocks_as_spent: false,
  buffer_scope: DEFAULT_BUFFER_SCOPE,
  travel_padding_minutes: 0,
  digest: DEFAULT_DIGEST,
  learn_estimates: false,
  learn_rhythm: true,
  balance_load: true,
  session_reminder_minutes: null,
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
    default_alerts: { ...DEFAULT_ALERTS, ...row.default_alerts },
    count_blocks_as_spent: row.count_blocks_as_spent,
    buffer_scope: { ...DEFAULT_BUFFER_SCOPE, ...row.buffer_scope },
    travel_padding_minutes: row.travel_padding_minutes,
    digest: { ...DEFAULT_DIGEST, ...row.digest },
    learn_estimates: row.learn_estimates ?? false,
    learn_rhythm: row.learn_rhythm ?? true,
    balance_load: row.balance_load ?? true,
    session_reminder_minutes: row.session_reminder_minutes ?? null,
  };
}

/** The place columns responses carry. */
export const PLACE_COLUMNS =
  "id, label, match, travel_minutes, mode, peak_minutes";

export async function loadPlaces(db: Db, userId: string): Promise<Place[]> {
  return (
    await db.query<Place>(
      `SELECT ${PLACE_COLUMNS} FROM places WHERE user_id = $1 ORDER BY label`,
      [userId],
    )
  ).rows;
}

/** The item columns expanding a series needs. */
export type SeriesRow = {
  id: string;
  kind: CalendarEntry["kind"];
  due_at: Date;
  end_at: Date | null;
  rrule: string | null;
  timezone: string;
  series_start: Date | null;
  exdates: Date[];
  all_day: boolean;
};

type EntryRow = SeriesRow & {
  title: string;
  status: CalendarEntry["status"];
  priority: CalendarEntry["priority"];
  team_id: string | null;
  team_name: string | null;
  list_id: string | null;
  location: string;
  meeting_url: string;
  version: number;
  busy: boolean;
  color: string | null;
  alerts: number[];
  attendee_count: number;
};

/** Occurrence changes by item, then by the occurrence's original start (ms). */
export type OverrideMap = Map<string, Map<number, OccurrenceChanges>>;

/** The changed occurrences of these items. */
export async function loadOverrides(
  db: Db,
  itemIds: string[],
): Promise<OverrideMap> {
  const out: OverrideMap = new Map();
  if (!itemIds.length) return out;
  const rows = (
    await db.query<{
      item_id: string;
      occurrence: Date;
      data: OccurrenceChanges;
    }>(
      "SELECT item_id, occurrence, data FROM item_overrides WHERE item_id = ANY ($1::uuid[])",
      [itemIds],
    )
  ).rows;
  for (const r of rows) {
    let byTime = out.get(r.item_id);
    if (!byTime) out.set(r.item_id, (byTime = new Map()));
    byTime.set(r.occurrence.getTime(), r.data);
  }
  return out;
}

/** Whole days an all-day item lasts (0 for an all-day task with no end). */
export const allDayLength = (r: SeriesRow) =>
  r.end_at ? Math.max(1, localDaysBetween(r.due_at, r.end_at, r.timezone)) : 0;

/**
 * Where an occurrence starting at `at` ends: the same length as the series,
 * counted in days for all-day items so daylight-saving changes don't move
 * them off midnight. Null when the item has no end.
 */
export function occurrenceEnd(r: SeriesRow, at: Date): Date | null {
  if (!r.end_at) return null;
  if (r.all_day) {
    const days = allDayLength(r);
    return dayTime(addDays(localDateKey(at, r.timezone), days), 0, r.timezone);
  }
  return new Date(at.getTime() + (r.end_at.getTime() - r.due_at.getTime()));
}

/** Whether `at` is an occurrence of the series (and not one skipped). */
export function isOccurrence(r: SeriesRow, at: Date) {
  if (!r.rrule) return false;
  return (
    occurrencesBetween(
      r.series_start ?? r.due_at,
      r.rrule,
      r.timezone,
      at,
      new Date(at.getTime() + 1),
      r.exdates,
    ).length === 1
  );
}

/**
 * The occurrences of a series overlapping [from, to), each with its own
 * start and end and the changes made to it alone. An occurrence moved into
 * the range from outside it is included; one moved out of it isn't.
 */
export function expandSeries(
  r: SeriesRow,
  from: Date,
  to: Date,
  changes: Map<number, OccurrenceChanges> = new Map(),
) {
  const out: {
    occurrence: Date;
    start: Date;
    end: Date | null;
    changes?: OccurrenceChanges;
  }[] = [];
  if (!r.rrule) return out;
  const length =
    r.end_at && !r.all_day ? r.end_at.getTime() - r.due_at.getTime() : 0;
  const lead = r.all_day ? allDayLength(r) * 86_400_000 + 3_600_000 : length;
  // Tasks: finished occurrences were moved past, so start from the current one.
  const shownFrom =
    r.kind === "task"
      ? new Date(Math.max(from.getTime(), r.due_at.getTime()))
      : new Date(from.getTime() - lead);
  const seen = new Set<number>();
  const starts = occurrencesBetween(
    r.series_start ?? r.due_at,
    r.rrule,
    r.timezone,
    shownFrom,
    to,
    r.exdates,
  );
  for (const at of starts) seen.add(at.getTime());
  for (const [key, c] of changes) {
    if (seen.has(key) || !c.due_at) continue;
    if (r.kind === "task" && key < r.due_at.getTime()) continue;
    const at = new Date(key);
    if (isOccurrence(r, at)) starts.push(at);
  }
  for (const at of starts) {
    const c = changes.get(at.getTime());
    const start = c?.due_at ? new Date(c.due_at) : at;
    const end = c?.due_at
      ? c.end_at
        ? new Date(c.end_at)
        : null
      : occurrenceEnd(r, at);
    if (start >= to || (end ?? start) < from) continue;
    out.push({ occurrence: at, start, end, changes: c });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Every occurrence of the items `userId` can see that overlaps [from, to):
 * one entry per occurrence for repeating items, with changes made to single
 * occurrences applied. A repeating task shows from its current occurrence
 * on; a repeating event shows its whole series. `itemIds` limits it to some
 * items (search).
 */
export async function calendarEntries(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  itemIds?: string[],
  options: { ai?: boolean } = {},
): Promise<CalendarEntry[]> {
  const rows = (
    await db.query<EntryRow>(
      `SELECT i.id, i.title, i.kind, i.status, i.priority, i.due_at, i.end_at,
              i.team_id, t.name AS team_name, i.list_id, i.location, i.meeting_url,
              i.rrule, i.timezone, i.series_start, i.exdates, i.version,
              i.all_day, i.busy, i.color, i.alerts,
              (SELECT count(*)::int FROM item_attendees x WHERE x.item_id = i.id) AS attendee_count
       FROM items i LEFT JOIN teams t ON t.id = i.team_id
       WHERE ${options.ai ? visibleAiItems() : visibleItems()} AND i.due_at IS NOT NULL AND (
         (i.rrule IS NULL AND i.due_at < $3 AND coalesce(i.end_at, i.due_at) >= $2)
         OR (i.rrule IS NOT NULL AND coalesce(i.series_start, i.due_at) < $3)
       ) AND ($4::uuid[] IS NULL OR i.id = ANY ($4::uuid[]))
       ORDER BY i.due_at LIMIT 2000`,
      [userId, from, to, itemIds ?? null],
    )
  ).rows;
  const overrides = await loadOverrides(
    db,
    rows.filter((r) => r.rrule).map((r) => r.id),
  );
  const entries: CalendarEntry[] = [];
  for (const r of rows) {
    // Free events, all-day items and tasks never count as busy.
    const busyOf = (busy: boolean) => r.kind === "event" && !r.all_day && busy;
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
      all_day: r.all_day,
      busy: busyOf(r.busy),
      color: r.color,
      alerts: r.alerts.map(Number),
      attendee_count: r.attendee_count,
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
    for (const o of expandSeries(r, from, to, overrides.get(r.id))) {
      const c = o.changes ?? {};
      entries.push({
        ...base,
        title: c.title ?? r.title,
        location: c.location ?? r.location,
        meeting_url: c.meeting_url ?? r.meeting_url,
        busy: busyOf(c.busy ?? r.busy),
        color: c.color !== undefined ? c.color : r.color,
        alerts: c.alerts ?? base.alerts,
        // Only the current occurrence of a repeating task can be done.
        status:
          r.kind === "task" && o.occurrence.getTime() !== r.due_at.getTime()
            ? "todo"
            : r.status,
        start_at: o.start.toISOString(),
        end_at: o.end ? o.end.toISOString() : null,
        occurrence: o.occurrence.toISOString(),
        overridden: !!o.changes,
      });
    }
  }
  return entries.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

/** Blocks `userId` set aside, for items they can still see. */
export async function timeBlocks(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  options: { ai?: boolean } = {},
): Promise<TimeBlock[]> {
  return (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              b.started_at, b.outcome, b.revision,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.user_id = $1 AND b.start_at < $3 AND b.end_at > $2 AND ${options.ai ? visibleAiItems() : visibleItems()}
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
): { minutes: number; label: string; place: Place | null } | null {
  const text = location.trim();
  if (!text || isLink(text)) return null;
  const lower = text.toLowerCase();
  const place = places.find((p) =>
    lower.includes(p.match.trim().toLowerCase()),
  );
  if (place)
    return place.travel_minutes
      ? { minutes: place.travel_minutes, label: place.label, place }
      : null;
  return fallback ? { minutes: fallback, label: text, place: null } : null;
}

/** Local peak travel hours on weekdays: 07:00-09:00 and 16:00-18:00. */
const PEAK_HOURS = [
  [7 * 60, 9 * 60],
  [16 * 60, 18 * 60],
] as const;

/**
 * Whether a leg touches peak hours on a weekday in `timeZone`. A leg that
 * would overlap them at its usual length takes the place's peak minutes.
 */
export function inPeak(start: number, end: number, timeZone: string) {
  for (
    let day = localDateKey(new Date(start), timeZone);
    day <= localDateKey(new Date(end), timeZone);
    day = addDays(day, 1)
  ) {
    const weekday = weekdayOf(day);
    if (weekday === 0 || weekday === 6) continue;
    for (const [from, to] of PEAK_HOURS)
      if (
        start < dayTime(day, to, timeZone).getTime() &&
        dayTime(day, from, timeZone).getTime() < end
      )
        return true;
  }
  return false;
}

/**
 * The minutes one travel leg takes: the usual minutes, or the place's peak
 * minutes when the leg (at its usual length) touches peak hours, plus the
 * person's travel padding. `edge` is the event's start (a leg there) or end
 * (a leg back).
 */
function legMinutes(
  travel: { minutes: number; place: Place | null },
  edge: number,
  direction: "to" | "back",
  prefs: PlannerPrefs,
) {
  const usual = travel.minutes * 60000;
  const [start, end] =
    direction === "to" ? [edge - usual, edge] : [edge, edge + usual];
  const peak = travel.place?.peak_minutes;
  const minutes =
    peak != null && inPeak(start, end, prefs.timezone) ? peak : travel.minutes;
  return minutes ? minutes + (prefs.travel_padding_minutes ?? 0) : 0;
}

/**
 * Whether an event gets buffers under the person's buffer scope: personal
 * or team events as chosen, in the chosen lists, long enough, and (when
 * asked) only meetings with others: people invited, a meeting link, or a
 * team event.
 */
export function inBufferScope(e: CalendarEntry, scope: BufferScope) {
  if (e.team_id) {
    if (scope.team_ids && !scope.team_ids.includes(e.team_id)) return false;
  } else if (!scope.personal) return false;
  if (
    scope.list_ids.length &&
    (!e.list_id || !scope.list_ids.includes(e.list_id))
  )
    return false;
  const minutes = (Date.parse(e.end_at!) - Date.parse(e.start_at)) / 60000;
  if (minutes < scope.min_minutes) return false;
  if (
    scope.only_with_others &&
    !(e.attendee_count ?? 0) &&
    !e.meeting_url.trim() &&
    !e.team_id
  )
    return false;
  return true;
}

const overlaps = (a: BusyInterval, b: BusyInterval) =>
  a.start_at < b.end_at && b.start_at < a.end_at;

/**
 * Buffers and travel time around timed events, worked out from the owner's
 * preferences and places rather than stored, so they always follow the
 * events. Travel goes right before a located event, and back after the last
 * located event of the day, each leg at the place's peak minutes in peak
 * hours and with the travel padding added; buffers go around meetings in the
 * buffer scope. Anything that would run into another event is left out.
 */
export function derivedBlocks(
  entries: CalendarEntry[],
  prefs: PlannerPrefs,
  places: Place[],
  localDay: (at: string) => string,
): DerivedBlock[] {
  // Free and all-day events get no buffers or travel.
  const events = entries.filter((e) => blocksTime(e) && e.end_at);
  const busy = events.map((e) => ({ start_at: e.start_at, end_at: e.end_at! }));
  const out: DerivedBlock[] = [];
  const shift = (at: string, minutes: number) =>
    new Date(Date.parse(at) + minutes * 60000).toISOString();
  const scope = prefs.buffer_scope ?? DEFAULT_BUFFER_SCOPE;
  const lastLocated = new Map<string, CalendarEntry>();
  for (const e of events) {
    const minutes = (Date.parse(e.end_at!) - Date.parse(e.start_at)) / 60000;
    const travel = travelMinutes(
      e.location,
      places,
      prefs.default_travel_minutes,
    );
    const buffer = inBufferScope(e, scope)
      ? bufferMinutes(prefs, minutes)
      : { before: 0, after: 0 };
    const leg = travel
      ? legMinutes(travel, Date.parse(e.start_at), "to", prefs)
      : 0;
    if (travel && leg) {
      out.push({
        kind: "travel",
        item_id: e.item_id,
        start_at: shift(e.start_at, -leg),
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
    const buffer = inBufferScope(e, scope)
      ? bufferMinutes(
          prefs,
          (Date.parse(e.end_at!) - Date.parse(e.start_at)) / 60000,
        ).after
      : 0;
    const leaves = Date.parse(e.end_at!) + buffer * 60000;
    const leg = legMinutes(travel, leaves, "back", prefs);
    out.push({
      kind: "travel",
      item_id: e.item_id,
      start_at: shift(e.end_at!, buffer),
      end_at: shift(e.end_at!, buffer + leg),
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
  /** AI facts exclude project and team sources kept out of the assistant. */
  ai?: boolean;
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
  /**
   * Who the busy time is for. "others" (teammates, the busy feed) leaves
   * out subscribed calendars you keep to yourself; booking pages and your
   * own planning ask as "self", so they always work around them.
   */
  audience?: "self" | "others";
};

/**
 * When `userId` is busy in [from, to): timed events, their buffers and
 * travel, blocks already set aside, and events from calendars they subscribe
 * to that count as busy (see ExternalOptions). Task due times are deadlines, not busy time; free and
 * all-day events don't count. Only intervals leave this function, never
 * titles.
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
      undefined,
      { ai: options.ai },
    )
  ).filter((e) => !skip.has(e.item_id));
  const events = entries.filter(blocksTime);
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
      ...(await timeBlocks(db, userId, from, to, { ai: options.ai }))
        .filter((b) => !exclude.has(b.id))
        .map((b) => ({ start_at: b.start_at, end_at: b.end_at })),
    );
    // Habit sessions are reserved time too, so tasks and other habits plan
    // around them (this is what stops a habit being placed on top of one).
    busy.push(
      ...(
        await db.query<{ start_at: Date; end_at: Date }>(
          "SELECT start_at, end_at FROM habit_blocks WHERE user_id = $1 AND end_at > $2 AND start_at < $3",
          [userId, from.toISOString(), to.toISOString()],
        )
      ).rows.map((b) => ({
        start_at: b.start_at.toISOString(),
        end_at: b.end_at.toISOString(),
      })),
    );
  }
  for (const e of await externalEntries(db, userId, from, to, {
    busy: true,
    audience: options.audience ?? "self",
  }))
    busy.push({ start_at: e.start_at, end_at: e.end_at });
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

/**
 * Everything on your calendar in [from, to) with its title: your own events
 * and your subscribed calendars' events, in start order. For things only you
 * see (digests, clash checks, the assistant, widgets); anything shared with
 * others reads busyIntervals instead. `hidden` includes calendars you've
 * hidden from view (they still count as busy, so a clash with one is real).
 */
export async function agendaEntries(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
  options: { hidden?: boolean; ai?: boolean } = {},
): Promise<AgendaEntry[]> {
  const [own, subscribed] = await Promise.all([
    calendarEntries(db, userId, from, to, undefined, { ai: options.ai }),
    externalEntries(db, userId, from, to, { visible: !options.hidden }),
  ]);
  const out: AgendaEntry[] = [
    ...own
      .filter((e) => e.kind === "event")
      .map((e) => ({
        source: "event" as const,
        item_id: e.item_id,
        title: e.title,
        start_at: e.start_at,
        end_at:
          e.end_at ??
          new Date(
            Date.parse(e.start_at) + DEFAULT_EVENT_MINUTES * 60000,
          ).toISOString(),
        all_day: !!e.all_day,
        location: e.location,
        busy: blocksTime(e),
        calendar: null,
        calendar_kind: null,
      })),
    ...subscribed.map((e) => ({
      source: "subscription" as const,
      subscription_id: e.subscription_id,
      item_id: null,
      title: e.title,
      start_at: e.start_at,
      end_at: e.end_at,
      all_day: e.all_day,
      location: e.location,
      busy: e.busy,
      calendar: e.name,
      calendar_kind: e.calendar_kind ?? null,
    })),
  ];
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}
