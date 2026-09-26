import {
  addDays,
  clockMinutes,
  dayTime,
  fail,
  frameInput,
  frameUpdate,
  habitApplyInput,
  habitPlanInput,
  habitUpdate,
  localDateKey,
  placeInput,
  placeUpdate,
  plannerPrefsInput,
  type Frame,
  type Habit,
  type HabitBlock,
  type HabitPlan,
  type Place,
  type PlannerAnalytics,
  type PlannerPrefs,
} from "@orbyn/core";
import type { z } from "zod";
import type { Db, Queryable } from "../../db/pool.js";
import { inMyTeams } from "../../lib/visibility.js";
import { busyIntervals, loadPrefs, PLACE_COLUMNS } from "./calendar.js";
import { FRAME_COLUMNS, daysForRule } from "./frames.js";
import { habitBlocksIn, habitById, loadHabits, placeHabits } from "./habits.js";

/**
 * The planner's routines and settings: frames (parts of the week kept for
 * something), habits and their proposed sessions, places, the planner's
 * settings and where time went. The routes and the agents' planner tools
 * (manage_routines, update_planner_settings, get_work_patterns) share these.
 */

/**
 * Change the planner's settings (working hours, horizon, buffers, learning
 * switches, notices and more); fields left out keep their value.
 */
export async function savePrefs(
  db: Db,
  userId: string,
  input: z.input<typeof plannerPrefsInput>,
): Promise<PlannerPrefs> {
  const d = plannerPrefsInput.parse(input);
  const current = await loadPrefs(db, userId);
  const alerts = current.default_alerts!;
  const next: PlannerPrefs = {
    ...current,
    ...d,
    planner_notices: {
      push: d.planner_notices?.push ?? current.planner_notices!.push,
      email: d.planner_notices?.email ?? current.planner_notices!.email,
    },
    default_alerts: {
      event: d.default_alerts?.event ?? alerts.event,
      task: d.default_alerts?.task ?? alerts.task,
      all_day: d.default_alerts?.all_day ?? alerts.all_day,
    },
    digest: { ...current.digest!, ...d.digest },
    learn_estimates: d.learn_estimates ?? current.learn_estimates,
    learn_rhythm: d.learn_rhythm ?? current.learn_rhythm,
    balance_load: d.balance_load ?? current.balance_load,
  };
  if (next.work_end <= next.work_start)
    fail(422, "Working hours must end after they start.");
  // Pinned people must share a team with you.
  if (d.pinned_user_ids?.length) {
    next.pinned_user_ids = (
      await db.query<{ user_id: string }>(
        `SELECT DISTINCT m.user_id FROM team_members m
     WHERE m.user_id = ANY ($2::uuid[]) AND m.user_id <> $1
       AND ${inMyTeams("m")}`,
        [userId, d.pinned_user_ids],
      )
    ).rows
      .map((x) => x.user_id)
      .filter((id) => d.pinned_user_ids!.includes(id));
  }
  await db.query(
    `INSERT INTO planner_prefs (user_id, timezone, work_days, work_start, work_end,
   pad_percent, split_after_minutes, min_block_minutes, break_level, horizon_days,
   buffer_before_minutes, buffer_after_minutes, adaptive_buffers,
   default_travel_minutes, extra_timezones, calendar_sets, pinned_user_ids,
   deadline_notice_days, planner_notices, default_alerts, count_blocks_as_spent,
   buffer_scope, travel_padding_minutes, digest, learn_estimates,
   learn_rhythm, balance_load, updated_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
   $21,$22,$23,$24,$25,$26,$27, now())
 ON CONFLICT (user_id) DO UPDATE SET timezone=$2, work_days=$3, work_start=$4,
   work_end=$5, pad_percent=$6, split_after_minutes=$7, min_block_minutes=$8,
   break_level=$9, horizon_days=$10, buffer_before_minutes=$11,
   buffer_after_minutes=$12, adaptive_buffers=$13, default_travel_minutes=$14,
   extra_timezones=$15, calendar_sets=$16, pinned_user_ids=$17,
   deadline_notice_days=$18, planner_notices=$19, default_alerts=$20,
   count_blocks_as_spent=$21, buffer_scope=$22, travel_padding_minutes=$23,
   digest=$24, learn_estimates=$25, learn_rhythm=$26, balance_load=$27,
   updated_at=now()`,
    [
      userId,
      next.timezone,
      next.work_days,
      next.work_start,
      next.work_end,
      next.pad_percent,
      next.split_after_minutes,
      next.min_block_minutes,
      next.break_level,
      next.horizon_days,
      next.buffer_before_minutes,
      next.buffer_after_minutes,
      next.adaptive_buffers,
      next.default_travel_minutes,
      next.extra_timezones,
      JSON.stringify(next.calendar_sets),
      next.pinned_user_ids,
      next.deadline_notice_days,
      JSON.stringify(next.planner_notices),
      JSON.stringify(next.default_alerts),
      next.count_blocks_as_spent ?? false,
      JSON.stringify(next.buffer_scope),
      next.travel_padding_minutes ?? 0,
      JSON.stringify(next.digest),
      next.learn_estimates ?? false,
      next.learn_rhythm ?? true,
      next.balance_load ?? true,
    ],
  );
  // Picking a zone here is a choice: the apps stop adopting the
  // device's zone from now on.
  if (d.timezone !== undefined)
    await db.query(
      "UPDATE planner_prefs SET timezone_chosen = true WHERE user_id = $1",
      [userId],
    );
  // Subscribed calendars are read in your zone (whole days, times with
  // no zone), so a new zone means reading them again from scratch.
  if (next.timezone !== current.timezone)
    await db.query(
      `UPDATE calendar_subscriptions SET etag = NULL, last_modified = NULL,
     content_hash = NULL, last_fetched_at = NULL
   WHERE user_id = $1`,
      [userId],
    );
  return loadPrefs(db, userId);
}

/** A frame: a recurring part of the week kept for something. */
export async function createFrame(
  db: Queryable,
  userId: string,
  input: z.input<typeof frameInput>,
): Promise<Frame> {
  const d = frameInput.parse(input);
  const rrule = d.rrule ?? null;
  const tz = d.timezone ?? (await loadPrefs(db, userId)).timezone;
  const frame = (
    await db.query<Frame>(
      `INSERT INTO frames (user_id, name, days, start_time, end_time, filters, color, position,
       rrule, series_start, busy, exdates, timezone)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, '#9ab68c'),
       (SELECT coalesce(max(position), -1) + 1 FROM frames WHERE user_id = $1),
       $8, $9, $10, $11::date[], $12)
     RETURNING ${FRAME_COLUMNS}`,
      [
        userId,
        d.name,
        rrule ? daysForRule(rrule) : d.days,
        d.start_time,
        d.end_time,
        JSON.stringify(d.filters),
        d.color ?? null,
        rrule,
        rrule ? localDateKey(new Date(), tz) : null,
        d.busy,
        d.exdates,
        d.timezone ?? null,
      ],
    )
  ).rows[0];
  return { ...frame, days: frame.days.map(Number) };
}

/** Change a frame (a new rule starts today). */
export async function updateFrame(
  db: Db,
  userId: string,
  id: string,
  input: z.input<typeof frameUpdate>,
): Promise<Frame> {
  const d = frameUpdate.parse(input);
  const current = (
    await db.query<Frame>(
      `SELECT ${FRAME_COLUMNS} FROM frames WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, userId],
    )
  ).rows[0];
  if (!current) fail(404, "Frame not found");
  const next = { ...current, ...d };
  if (next.end_time <= next.start_time)
    fail(422, "A frame ends after it starts.");
  // A new rule starts today; its weekdays are kept in `days` for older apps.
  const ruleChanged = d.rrule !== undefined && d.rrule !== current.rrule;
  let seriesStart = current.series_start ?? null;
  if (ruleChanged && next.rrule) {
    const tz = next.timezone ?? (await loadPrefs(db, userId)).timezone;
    seriesStart = localDateKey(new Date(), tz);
  }
  // A rule decides the weekdays; `days` mirrors it for older apps.
  if (next.rrule) next.days = daysForRule(next.rrule);
  const frame = (
    await db.query<Frame>(
      `UPDATE frames SET name=$2, days=$3, start_time=$4, end_time=$5, filters=$6,
     color=$7, position=$8, rrule=$9, series_start=$10, busy=$11,
     exdates=$12::date[], timezone=$13
   WHERE id=$1 RETURNING ${FRAME_COLUMNS}`,
      [
        current.id,
        next.name,
        next.days,
        next.start_time,
        next.end_time,
        JSON.stringify(next.filters),
        next.color,
        next.position,
        next.rrule ?? null,
        next.rrule ? seriesStart : null,
        next.busy ?? false,
        next.exdates ?? [],
        next.timezone ?? null,
      ],
    )
  ).rows[0];
  return { ...frame, days: frame.days.map(Number) };
}

/** Skip one date of a frame ("not this Friday"), or bring it back. */
export async function skipFrame(
  db: Queryable,
  userId: string,
  id: string,
  date: string,
  add: boolean,
): Promise<Frame> {
  const frame = (
    await db.query<Frame>(
      `UPDATE frames SET exdates = CASE WHEN $3
         THEN (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(array_append(exdates, $4::date)) x)
         ELSE array_remove(exdates, $4::date) END
       WHERE id = $1 AND user_id = $2 RETURNING ${FRAME_COLUMNS}`,
      [id, userId, add, date],
    )
  ).rows[0];
  if (!frame) fail(404, "Frame not found");
  return { ...frame, days: frame.days.map(Number) };
}

/** Remove one of `userId`'s frames (404 when it isn't theirs). */
export async function deleteFrame(db: Queryable, userId: string, id: string) {
  const deleted = await db.query(
    "DELETE FROM frames WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!deleted.rowCount) fail(404, "Frame not found");
}

/** Remove one of `userId`'s habits (404 when it isn't theirs). */
export async function deleteHabit(db: Queryable, userId: string, id: string) {
  const deleted = await db.query(
    "DELETE FROM habits WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!deleted.rowCount) fail(404, "Habit not found");
}

/** Remove one of `userId`'s places (404 when it isn't theirs). */
export async function deletePlace(db: Queryable, userId: string, id: string) {
  const deleted = await db.query(
    "DELETE FROM places WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!deleted.rowCount) fail(404, "Place not found");
}

/** Remove one of `userId`'s habit blocks (404 when it isn't theirs). */
export async function deleteHabitBlock(
  db: Queryable,
  userId: string,
  id: string,
) {
  const deleted = await db.query(
    "DELETE FROM habit_blocks WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!deleted.rowCount) fail(404, "Habit session not found");
}

/** Change a habit. */
export async function updateHabit(
  db: Db,
  userId: string,
  id: string,
  input: z.input<typeof habitUpdate>,
): Promise<Habit> {
  const d = habitUpdate.parse(input);
  const current = await habitById(db, id, userId);
  if (!current) fail(404, "Habit not found");
  const start =
    d.window_start === undefined ? current.window_start : d.window_start;
  const end = d.window_end === undefined ? current.window_end : d.window_end;
  if (start && end && end <= start)
    fail(422, "A habit's window ends after it starts");
  await db.query(
    `UPDATE habits SET name = $3, cadence = $4, period = $5,
   duration_minutes = $6, days = $7, window_start = $8, window_end = $9,
   priority = $10, active = $11, position = $12, updated_at = now()
 WHERE id = $1 AND user_id = $2`,
    [
      current.id,
      userId,
      d.name ?? current.name,
      d.cadence ?? current.cadence,
      d.period ?? current.period,
      d.duration_minutes ?? current.duration_minutes,
      d.days ?? current.days,
      start,
      end,
      d.priority ?? current.priority,
      d.active ?? current.active,
      d.position ?? current.position,
    ],
  );
  return (await habitById(db, current.id, userId))!;
}

/**
 * Sessions for the active habits over the next few days, proposed and
 * never saved; applying them is applyHabitPlan.
 */
export async function habitPlan(
  db: Queryable,
  userId: string,
  input: z.input<typeof habitPlanInput>,
  now = new Date(),
): Promise<HabitPlan> {
  const d = habitPlanInput.parse(input);
  const prefs = await loadPrefs(db, userId);
  const start = d.start_date ?? localDateKey(now, prefs.timezone);
  const days = Array.from({ length: d.days }, (_, i) => addDays(start, i));
  const from = dayTime(days[0], 0, prefs.timezone);
  const to = dayTime(addDays(days.at(-1)!, 1), 0, prefs.timezone);
  const habits = await loadHabits(db, userId, true);
  if (!habits.length) return { blocks: [], summary: [] };
  const [busy, existing] = await Promise.all([
    busyIntervals(db, userId, from, to),
    habitBlocksIn(db, userId, from, to),
  ]);
  return placeHabits({
    habits,
    busy: busy.map((b) => ({
      start: Date.parse(b.start_at),
      end: Date.parse(b.end_at),
    })),
    days,
    timezone: prefs.timezone,
    workStart: clockMinutes(prefs.work_start),
    workEnd: clockMinutes(prefs.work_end),
    existing: existing.map((b) => ({
      habit_id: b.habit_id,
      start: Date.parse(b.start_at),
    })),
    now: now.getTime(),
  });
}

/** Save proposed habit sessions, skipping any that now clash with busy time. */
export async function applyHabitPlan(
  db: Db,
  userId: string,
  input: z.input<typeof habitApplyInput>,
): Promise<HabitBlock[]> {
  const d = habitApplyInput.parse(input);
  const mine = new Set((await loadHabits(db, userId)).map((h) => h.id));
  const starts = d.blocks.map((b) => Date.parse(b.start_at));
  const ends = d.blocks.map((b) => Date.parse(b.end_at));
  const busy = await busyIntervals(
    db,
    userId,
    new Date(Math.min(...starts)),
    new Date(Math.max(...ends)),
  );
  const created: string[] = [];
  for (const b of d.blocks) {
    if (!mine.has(b.habit_id)) continue;
    if (Date.parse(b.end_at) <= Date.parse(b.start_at)) continue;
    const clash = busy.some(
      (x) => x.start_at < b.end_at && b.start_at < x.end_at,
    );
    if (clash) continue;
    const { id } = (
      await db.query<{ id: string }>(
        `INSERT INTO habit_blocks (habit_id, user_id, start_at, end_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
        [b.habit_id, userId, b.start_at, b.end_at],
      )
    ).rows[0];
    created.push(id);
    busy.push({ start_at: b.start_at, end_at: b.end_at });
  }
  return habitBlocksIn(
    db,
    userId,
    new Date(Math.min(...starts)),
    new Date(Math.max(...ends) + 1),
  );
}

/** A place, with the travel time to it. */
export async function createPlace(
  db: Queryable,
  userId: string,
  input: z.input<typeof placeInput>,
): Promise<Place> {
  const d = placeInput.parse(input);
  return (
    await db.query<Place>(
      `INSERT INTO places (user_id, label, match, travel_minutes, mode, peak_minutes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PLACE_COLUMNS}`,
      [userId, d.label, d.match, d.travel_minutes, d.mode, d.peak_minutes],
    )
  ).rows[0];
}

/** Change a place. */
export async function updatePlace(
  db: Queryable,
  userId: string,
  id: string,
  input: z.input<typeof placeUpdate>,
): Promise<Place> {
  const d = placeUpdate.parse(input);
  const place = (
    await db.query<Place>(
      `UPDATE places SET label = coalesce($3, label), match = coalesce($4, match),
       travel_minutes = coalesce($5, travel_minutes),
       mode = CASE WHEN $6 THEN $7 ELSE mode END,
       peak_minutes = CASE WHEN $8 THEN $9::smallint ELSE peak_minutes END
     WHERE id = $1 AND user_id = $2 RETURNING ${PLACE_COLUMNS}`,
      [
        id,
        userId,
        d.label ?? null,
        d.match ?? null,
        d.travel_minutes ?? null,
        d.mode !== undefined,
        d.mode ?? null,
        d.peak_minutes !== undefined,
        d.peak_minutes ?? null,
      ],
    )
  ).rows[0];
  if (!place) fail(404, "Place not found");
  return place;
}

/** Where set-aside time went over `days`: totals, by list and by tag. */
export async function plannerAnalytics(
  db: Queryable,
  userId: string,
  days: number,
  now = new Date(),
): Promise<PlannerAnalytics> {
  const from = new Date(now.getTime() - days * 86_400_000);
  const mins = `sum(extract(epoch FROM (b.end_at - b.start_at)) / 60)::int`;
  const [planned, byList, byTag, completed] = await Promise.all([
    db.query<{ minutes: number | null }>(
      `SELECT ${mins} AS minutes FROM time_blocks b WHERE b.user_id=$1 AND b.start_at >= $2`,
      [userId, from.toISOString()],
    ),
    db.query<{ name: string | null; minutes: number }>(
      `SELECT (SELECT name FROM lists l WHERE l.id = i.list_id) AS name, ${mins} AS minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id
      WHERE b.user_id=$1 AND b.start_at >= $2
      GROUP BY i.list_id ORDER BY minutes DESC NULLS LAST LIMIT 12`,
      [userId, from.toISOString()],
    ),
    db.query<{ name: string; minutes: number }>(
      `SELECT t.name, ${mins} AS minutes
       FROM time_blocks b JOIN item_tags it ON it.item_id = b.item_id
       JOIN tags t ON t.id = it.tag_id
      WHERE b.user_id=$1 AND b.start_at >= $2
      GROUP BY t.name ORDER BY minutes DESC LIMIT 12`,
      [userId, from.toISOString()],
    ),
    db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM items
      WHERE user_id=$1 AND status='done' AND updated_at >= $2`,
      [userId, from.toISOString()],
    ),
  ]);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    days,
    planned_minutes: planned.rows[0].minutes ?? 0,
    completed: completed.rows[0].n,
    by_list: byList.rows.map((x) => ({
      name: x.name ?? "No list",
      minutes: x.minutes,
    })),
    by_tag: byTag.rows.map((x) => ({ name: x.name, minutes: x.minutes })),
  };
}
