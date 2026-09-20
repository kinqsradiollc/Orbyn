import {
  addDays,
  clockMinutes,
  dayTime,
  weekdayOf,
  type Habit,
  type HabitBlock,
  type HabitPlan,
  type Priority,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";

export const HABIT_COLUMNS = `h.id, h.name, h.cadence, h.period, h.duration_minutes,
  h.days::int[] AS days, to_char(h.window_start, 'HH24:MI') AS window_start,
  to_char(h.window_end, 'HH24:MI') AS window_end, h.priority, h.active, h.position,
  h.created_at`;

type HabitRow = Omit<Habit, "created_at" | "progress"> & { created_at: Date };

const toHabit = (r: HabitRow): Habit => ({
  ...r,
  created_at: r.created_at.toISOString(),
});

/** A user's habits, newest positions first. `activeOnly` for planning. */
export async function loadHabits(
  db: Db,
  userId: string,
  activeOnly = false,
): Promise<Habit[]> {
  const rows = (
    await db.query<HabitRow>(
      `SELECT ${HABIT_COLUMNS} FROM habits h
         WHERE h.user_id = $1 ${activeOnly ? "AND h.active" : ""}
         ORDER BY h.position, h.created_at`,
      [userId],
    )
  ).rows;
  return rows.map(toHabit);
}

export async function habitById(
  db: Db,
  id: string,
  userId: string,
): Promise<Habit | null> {
  const r = (
    await db.query<HabitRow>(
      `SELECT ${HABIT_COLUMNS} FROM habits h WHERE h.id = $1 AND h.user_id = $2`,
      [id, userId],
    )
  ).rows[0];
  return r ? toHabit(r) : null;
}

/** Habit sessions already set aside in [from, to), with their habit's name. */
export async function habitBlocksIn(
  db: Db,
  userId: string,
  from: Date,
  to: Date,
): Promise<HabitBlock[]> {
  const rows = (
    await db.query<{
      id: string;
      habit_id: string;
      name: string;
      start_at: Date;
      end_at: Date;
      source: "manual" | "planner";
    }>(
      `SELECT b.id, b.habit_id, h.name, b.start_at, b.end_at, b.source
         FROM habit_blocks b JOIN habits h ON h.id = b.habit_id
         WHERE b.user_id = $1 AND b.end_at > $2 AND b.start_at < $3
         ORDER BY b.start_at`,
      [userId, from.toISOString(), to.toISOString()],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    habit_id: r.habit_id,
    name: r.name,
    start_at: r.start_at.toISOString(),
    end_at: r.end_at.toISOString(),
    source: r.source,
  }));
}

// ---- placement (pure) ------------------------------------------------------

const MINUTE = 60_000;
const GRID = 5;

type PlaceHabit = {
  id: string;
  name: string;
  cadence: number;
  period: "day" | "week";
  duration_minutes: number;
  days: number[];
  window_start: string | null;
  window_end: string | null;
  priority: Priority;
};

export type PlaceInput = {
  habits: PlaceHabit[];
  /** Busy time in ms, need not be merged or sorted. */
  busy: { start: number; end: number }[];
  /** Day keys "YYYY-MM-DD" in `timezone`, in order. */
  days: string[];
  timezone: string;
  /** Working hours in minutes, the fallback window. */
  workStart: number;
  workEnd: number;
  /** Existing habit sessions in the window: which habit, and when it starts. */
  existing: { habit_id: string; start: number }[];
  now: number;
};

const ceilToGrid = (ms: number) =>
  Math.ceil(ms / (GRID * MINUTE)) * (GRID * MINUTE);

/** The Monday-start week key a day falls in, so weekly habits bucket by week. */
const weekKey = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
const periodKey = (habit: PlaceHabit, day: string) =>
  habit.period === "day" ? day : weekKey(day);

const overlaps = (
  start: number,
  end: number,
  busy: { start: number; end: number }[],
) => busy.some((b) => b.start < end && start < b.end);

/**
 * Place habit sessions into free time, deterministically. Higher-priority
 * habits go first; each habit spreads its sessions across different days
 * before doubling up, keeps inside its time-of-day window and allowed
 * weekdays, and never overlaps a busy interval or a session placed before it.
 * Sessions already set aside count towards the period's target, so re-running
 * only tops up what's missing — and, run against a changed calendar, proposes
 * the sessions in new free time (that is what makes a habit "flexible").
 */
export function placeHabits(input: PlaceInput): HabitPlan {
  const busy = input.busy
    .map((b) => ({ start: b.start, end: b.end }))
    .sort((a, b) => a.start - b.start);
  const blocks: HabitPlan["blocks"] = [];
  const summary: HabitPlan["summary"] = [];
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  const habits = [...input.habits].sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] || a.name.localeCompare(b.name),
  );

  for (const habit of habits) {
    const length = habit.duration_minutes * MINUTE;
    const ws =
      habit.window_start != null
        ? clockMinutes(habit.window_start)
        : input.workStart;
    const we =
      habit.window_end != null ? clockMinutes(habit.window_end) : input.workEnd;
    const allowed = new Set(habit.days);
    const eligible = input.days.filter((d) => allowed.has(weekdayOf(d)));

    // How many sessions each period already holds (existing + placed here).
    const have = new Map<string, number>();
    for (const e of input.existing)
      if (e.habit_id === habit.id) {
        const day = input.days.find((d) => {
          const s = dayTime(d, 0, input.timezone).getTime();
          return e.start >= s && e.start < s + 86_400_000;
        });
        if (day) {
          const k = periodKey(habit, day);
          have.set(k, (have.get(k) ?? 0) + 1);
        }
      }
    const before = new Map(have);
    // Sessions this run has put on each specific day (to spread first).
    const perDay = new Map<string, number>();

    // Two passes: one session per day first (spread), then allow a second.
    for (let pass = 0; pass < 2; pass++) {
      for (const day of eligible) {
        const k = periodKey(habit, day);
        if ((have.get(k) ?? 0) >= habit.cadence) continue;
        if (pass === 0 && (perDay.get(day) ?? 0) >= 1) continue;
        if ((perDay.get(day) ?? 0) >= 2) continue;
        const dayStart = dayTime(day, 0, input.timezone).getTime();
        const winEnd = dayStart + we * MINUTE;
        // Earliest grid-aligned start whose whole session is free.
        let start = ceilToGrid(Math.max(dayStart + ws * MINUTE, input.now));
        while (start + length <= winEnd) {
          if (!overlaps(start, start + length, busy)) {
            blocks.push({
              habit_id: habit.id,
              name: habit.name,
              start_at: new Date(start).toISOString(),
              end_at: new Date(start + length).toISOString(),
            });
            busy.push({ start, end: start + length });
            busy.sort((a, b) => a.start - b.start);
            have.set(k, (have.get(k) ?? 0) + 1);
            perDay.set(day, (perDay.get(day) ?? 0) + 1);
            break;
          }
          start += GRID * MINUTE;
        }
      }
    }

    // The window's target: for each period touched, top up to cadence.
    const periods = new Set(eligible.map((d) => periodKey(habit, d)));
    let needed = 0;
    let placedCount = 0;
    for (const k of periods) {
      const target = habit.cadence - (before.get(k) ?? 0);
      needed += Math.max(0, target);
      placedCount += Math.max(0, (have.get(k) ?? 0) - (before.get(k) ?? 0));
    }
    summary.push({
      habit_id: habit.id,
      name: habit.name,
      placed: placedCount,
      needed,
      reason:
        placedCount >= needed
          ? null
          : eligible.length === 0
            ? "No allowed days in this range."
            : "Not enough free time in the window.",
    });
  }
  blocks.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return { blocks, summary };
}
