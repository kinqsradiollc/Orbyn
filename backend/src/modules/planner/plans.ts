import {
  addDays,
  clockMinutes,
  dayTime,
  localDateKey,
  weekdayOf,
  type AtRiskTask,
  type BusyInterval,
  type Frame,
  type Plan,
  type PlannerPrefs,
  type PlannerReview,
  type TimeBlock,
  type planPreviewInput,
} from "@orbyn/core";
import type { z } from "zod";
import type { Queryable as Db } from "../../db/pool.js";
import { fail } from "@orbyn/core";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import {
  busyIntervals,
  calendarEntries,
  loadPrefs,
  mergeIntervals,
  timeBlocks,
} from "./calendar.js";
import {
  DEFAULT_ESTIMATE_MINUTES,
  schedule,
  type SchedulerResult,
  type SchedulerTask,
} from "./scheduler.js";

export type PreviewInput = z.output<typeof planPreviewInput>;

export const FRAME_COLUMNS = `id, name, days, to_char(start_time, 'HH24:MI') AS start_time,
  to_char(end_time, 'HH24:MI') AS end_time, filters, color, position`;

export async function loadFrames(db: Db, userId: string): Promise<Frame[]> {
  return (
    await db.query<Frame>(
      `SELECT ${FRAME_COLUMNS} FROM frames WHERE user_id = $1 ORDER BY position, start_time`,
      [userId],
    )
  ).rows.map((f) => ({ ...f, days: f.days.map(Number) }));
}

/**
 * Open tasks the planner considers: your personal tasks and team tasks
 * assigned to you. Naming tasks (`only`) lets it plan any task you can see.
 */
async function candidateTasks(
  db: Db,
  userId: string,
  only?: string[],
  exclude: string[] = [],
): Promise<SchedulerTask[]> {
  const rows = (
    await db.query<SchedulerTask & { due_at: Date | null }>(
      `SELECT i.id, i.title, i.priority, i.status, i.due_at, i.estimate_minutes,
              i.spent_minutes, i.list_id, i.team_id,
              coalesce((SELECT array_agg(x.tag_id) FROM item_tags x WHERE x.item_id = i.id), '{}') AS tag_ids,
              coalesce((SELECT sum(extract(epoch FROM (b.end_at - greatest(b.start_at, now()))) / 60)
                        FROM time_blocks b
                        WHERE b.item_id = i.id AND b.user_id = $1 AND b.end_at > now()), 0)::int
                AS scheduled_minutes
       FROM items i
       WHERE i.kind = 'task' AND i.status <> 'done'
         AND NOT (i.id = ANY ($3::uuid[]))
         AND CASE WHEN $2::uuid[] IS NULL
           THEN (i.team_id IS NULL AND i.user_id = $1)
             OR (i.assignee_id = $1 AND i.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
           ELSE i.id = ANY ($2::uuid[]) AND ${VISIBLE_ITEMS} END
       ORDER BY i.due_at NULLS LAST, i.created_at LIMIT 300`,
      [userId, only ?? null, exclude],
    )
  ).rows;
  return rows.map((t) => ({
    ...t,
    due_at: t.due_at ? new Date(t.due_at).toISOString() : null,
  }));
}

const hoursLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One sentence about a plan, for the preview and the assistant. */
export function describePlan(result: SchedulerResult, days: number) {
  const tasks = new Set(result.blocks.map((b) => b.item_id)).size;
  const notes: string[] = [];
  if (result.unplaced.length)
    notes.push(`${plural(result.unplaced.length, "task")} couldn't be placed.`);
  if (result.at_risk.length)
    notes.push(`${plural(result.at_risk.length, "task")} may run late.`);
  if (!result.blocks.length)
    return result.unplaced.length
      ? `Nothing fits yet. ${notes.join(" ")}`
      : "There's nothing to plan: no open task needs time.";
  return [
    `${plural(tasks, "task")} in ${plural(result.blocks.length, "block")} over ${plural(days, "day")}, using ${hoursLabel(result.planned_minutes)} of ${hoursLabel(result.capacity_minutes)} free.`,
    ...notes,
  ].join(" ");
}

/** Build a plan, store it for an hour, and return it. Nothing else is saved. */
export async function makePlan(
  db: Db,
  userId: string,
  d: PreviewInput,
  now = new Date(),
): Promise<Plan> {
  const prefs = await loadPrefs(db, userId);
  // Someone who hasn't chosen a time zone yet plans in their device's.
  const tz =
    prefs.timezone === "UTC" && d.timezone ? d.timezone : prefs.timezone;
  const today = localDateKey(now, tz);
  const start = d.start_date && d.start_date > today ? d.start_date : today;
  const days = d.days ?? prefs.horizon_days;
  const dayKeys = Array.from({ length: days }, (_, i) => addDays(start, i));
  const from = dayTime(start, 0, tz);
  const to = dayTime(addDays(start, days), 0, tz);
  const busy = await busyIntervals(db, userId, from, to);
  busy.push(...d.keep_free);
  const [frames, tasks] = await Promise.all([
    loadFrames(db, userId),
    candidateTasks(db, userId, d.item_ids, d.exclude_item_ids),
  ]);
  const result = schedule({
    tasks,
    busy,
    frames,
    useFrames: d.use_frames,
    days: dayKeys,
    timezone: tz,
    workDays: prefs.work_days,
    workStart: prefs.work_start,
    workEnd: prefs.work_end,
    padPercent: d.pad_percent ?? prefs.pad_percent,
    split: d.split ?? true,
    splitAfterMinutes: prefs.split_after_minutes,
    minBlockMinutes: prefs.min_block_minutes,
    breakLevel: d.break_level ?? prefs.break_level,
    now,
  });
  const summary = describePlan(result, days);
  const row = (
    await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO plans (user_id, starts_on, days, options, blocks, unplaced)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, expires_at`,
      [
        userId,
        start,
        days,
        JSON.stringify({
          input: d,
          at_risk: result.at_risk,
          capacity_minutes: result.capacity_minutes,
          planned_minutes: result.planned_minutes,
          summary,
        }),
        JSON.stringify(result.blocks),
        JSON.stringify(result.unplaced),
      ],
    )
  ).rows[0];
  return {
    id: row.id,
    starts_on: start,
    days,
    ...result,
    applied: false,
    expires_at: row.expires_at.toISOString(),
    summary,
  };
}

export async function planById(
  db: Db,
  id: string,
  userId: string,
): Promise<Plan> {
  const row = (
    await db.query<{
      id: string;
      starts_on: string | Date;
      days: number;
      options: {
        at_risk?: Plan["at_risk"];
        capacity_minutes?: number;
        planned_minutes?: number;
        summary?: string;
      };
      blocks: Plan["blocks"];
      unplaced: Plan["unplaced"];
      applied: boolean;
      expires_at: Date;
    }>(
      "SELECT id, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, days, options, blocks, unplaced, applied, expires_at FROM plans WHERE id = $1 AND user_id = $2",
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "Plan not found");
  return {
    id: row.id,
    starts_on: String(row.starts_on),
    days: row.days,
    blocks: row.blocks,
    unplaced: row.unplaced,
    at_risk: row.options.at_risk ?? [],
    capacity_minutes: row.options.capacity_minutes ?? 0,
    planned_minutes: row.options.planned_minutes ?? 0,
    applied: row.applied,
    expires_at: row.expires_at.toISOString(),
    summary: row.options.summary ?? "",
  };
}

type Span = { start: number; end: number };

/** Working hours between two instants, as spans. */
export function workingSpans(
  prefs: PlannerPrefs,
  from: Date,
  to: Date,
): Span[] {
  const spans: Span[] = [];
  const last = localDateKey(to, prefs.timezone);
  for (
    let day = localDateKey(from, prefs.timezone);
    day <= last;
    day = addDays(day, 1)
  ) {
    if (!prefs.work_days.includes(weekdayOf(day))) continue;
    const start = Math.max(
      dayTime(day, clockMinutes(prefs.work_start), prefs.timezone).getTime(),
      from.getTime(),
    );
    const end = Math.min(
      dayTime(day, clockMinutes(prefs.work_end), prefs.timezone).getTime(),
      to.getTime(),
    );
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/** Spans minus busy intervals. */
export function freeSpans(spans: Span[], busy: BusyInterval[]): Span[] {
  const merged = mergeIntervals(busy).map((b) => ({
    start: Date.parse(b.start_at),
    end: Date.parse(b.end_at),
  }));
  const out: Span[] = [];
  for (const span of spans) {
    let cursor = span.start;
    for (const b of merged) {
      if (b.end <= cursor || b.start >= span.end) continue;
      if (b.start > cursor) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < span.end) out.push({ start: cursor, end: span.end });
  }
  return out;
}

const FIVE_MINUTES = 5 * 60_000;

/** The next free working slot of `minutes` in the coming week. */
export async function workingFree(
  db: Db,
  userId: string,
  minutes: number,
  excludeBlockIds: string[] = [],
  now = new Date(),
): Promise<BusyInterval | null> {
  const prefs = await loadPrefs(db, userId);
  const from = new Date(Math.ceil(now.getTime() / FIVE_MINUTES) * FIVE_MINUTES);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const busy = await busyIntervals(db, userId, from, to, {
    blocks: true,
    derived: true,
    excludeBlockIds,
  });
  const need = minutes * 60_000;
  const slot = freeSpans(workingSpans(prefs, from, to), busy).find(
    (s) => s.end - Math.ceil(s.start / FIVE_MINUTES) * FIVE_MINUTES >= need,
  );
  if (!slot) return null;
  const start = Math.ceil(slot.start / FIVE_MINUTES) * FIVE_MINUTES;
  return {
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + need).toISOString(),
  };
}

const REVIEW_DAYS = 14;

/** Unfinished blocks, tasks at risk of running late, and blocks that clash with events. */
export async function reviewFor(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<PlannerReview> {
  const horizon = new Date(now.getTime() + REVIEW_DAYS * 86_400_000);
  const unfinished = (
    await db.query<TimeBlock>(
      `SELECT b.id, b.item_id, b.user_id, b.start_at, b.end_at, b.source, b.plan_id,
              i.title, i.status, i.kind, i.priority, i.team_id, i.list_id, i.estimate_minutes
       FROM time_blocks b JOIN items i ON i.id = b.item_id
       WHERE b.user_id = $1 AND b.end_at < $2 AND b.end_at > $2 - interval '14 days'
         AND i.status <> 'done' AND ${VISIBLE_ITEMS}
         AND NOT EXISTS (SELECT 1 FROM time_blocks f
                         WHERE f.item_id = b.item_id AND f.user_id = $1 AND f.start_at >= $2)
       ORDER BY b.start_at`,
      [userId, now],
    )
  ).rows.map((b) => ({
    ...b,
    start_at: new Date(b.start_at).toISOString(),
    end_at: new Date(b.end_at).toISOString(),
  }));

  const [entries, blocks, tasks, prefs] = await Promise.all([
    calendarEntries(db, userId, now, horizon),
    timeBlocks(db, userId, now, horizon),
    candidateTasks(db, userId),
    loadPrefs(db, userId),
  ]);
  const events = entries.filter(
    (e) => e.kind === "event" && e.status !== "done" && e.end_at,
  );
  const nowIso = now.toISOString();
  const conflicts: PlannerReview["conflicts"] = [];
  for (const block of blocks) {
    if (block.start_at < nowIso) continue;
    const entry = events.find(
      (e) => e.start_at < block.end_at && block.start_at < e.end_at!,
    );
    if (entry) conflicts.push({ block, entry });
  }

  const busy = await busyIntervals(db, userId, now, horizon, {
    blocks: false,
    derived: true,
  });
  const free = freeSpans(workingSpans(prefs, now, horizon), busy);
  const atRisk: AtRiskTask[] = [];
  for (const t of tasks) {
    if (!t.due_at || t.status === "blocked") continue;
    const due = Date.parse(t.due_at);
    if (due <= now.getTime() || due > horizon.getTime()) continue;
    const estimate = t.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES;
    const remaining = Math.max(
      0,
      estimate - t.spent_minutes - t.scheduled_minutes,
    );
    if (!remaining) continue;
    const freeMinutes = Math.round(
      free.reduce(
        (sum, s) => sum + Math.max(0, Math.min(s.end, due) - s.start) / 60_000,
        0,
      ),
    );
    if (remaining > freeMinutes)
      atRisk.push({
        item_id: t.id,
        title: t.title,
        due_at: t.due_at,
        reason: `Needs ${hoursLabel(remaining)} more, with ${hoursLabel(freeMinutes)} free before it's due.`,
        remaining_minutes: remaining,
        free_minutes: freeMinutes,
      });
  }
  return { unfinished, at_risk: atRisk, conflicts };
}
