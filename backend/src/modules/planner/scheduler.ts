import {
  addDays,
  clockMinutes,
  dayTime,
  priorityScore,
  weekdayOf,
  type BreakLevel,
  type BusyInterval,
  type Frame,
  type PlannedBlock,
  type Priority,
  type Status,
  type UnplacedTask,
} from "@orbyn/core";

/**
 * The planner's placement engine. Deterministic and pure: the same tasks,
 * calendar and settings always give the same plan, and nothing here reads the
 * clock or the database. The assistant never places blocks itself; it only
 * changes these inputs ("keep Friday afternoon free") and explains the result.
 */
export type SchedulerTask = {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  due_at: string | null;
  estimate_minutes: number | null;
  spent_minutes: number;
  /** Future time already set aside for this task. */
  scheduled_minutes: number;
  list_id: string | null;
  tag_ids: string[];
  team_id: string | null;
};

export type SchedulerInput = {
  tasks: SchedulerTask[];
  /** Busy time: events, buffers, travel, other blocks, keep-free times. */
  busy: BusyInterval[];
  frames: Frame[];
  useFrames: boolean;
  /** The days to plan, "YYYY-MM-DD" in `timezone`. */
  days: string[];
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  padPercent: number;
  split: boolean;
  splitAfterMinutes: number;
  minBlockMinutes: number;
  breakLevel: BreakLevel;
  now: Date;
};

export type SchedulerResult = {
  blocks: PlannedBlock[];
  unplaced: UnplacedTask[];
  at_risk: UnplacedTask[];
  capacity_minutes: number;
  planned_minutes: number;
};

/** A task without an estimate is planned as this long. */
export const DEFAULT_ESTIMATE_MINUTES = 30;
const GRID_MINUTES = 5;
const MAX_SESSIONS = 12;
/** Rest after a session of 45 minutes or more. */
const BREAK_MINUTES: Record<BreakLevel, number> = {
  none: 0,
  light: 5,
  normal: 10,
  intense: 15,
};

type Segment = { start: number; end: number; frame: Frame | null };

const MINUTE = 60_000;
const ceilToGrid = (ms: number) =>
  Math.ceil(ms / (GRID_MINUTES * MINUTE)) * GRID_MINUTES * MINUTE;
const roundUpMinutes = (minutes: number) =>
  Math.ceil(minutes / GRID_MINUTES) * GRID_MINUTES;

/** Working windows per day: the frames that apply, or working hours. */
function windows(input: SchedulerInput): Segment[] {
  const out: Segment[] = [];
  const earliest = ceilToGrid(input.now.getTime());
  for (const day of input.days) {
    const weekday = weekdayOf(day);
    const spans: { start: number; end: number; frame: Frame | null }[] = [];
    if (input.useFrames && input.frames.length) {
      for (const f of input.frames)
        if (f.days.includes(weekday))
          spans.push({
            start: clockMinutes(f.start_time),
            end: clockMinutes(f.end_time),
            frame: f,
          });
    } else if (input.workDays.includes(weekday))
      spans.push({
        start: clockMinutes(input.workStart),
        end: clockMinutes(input.workEnd),
        frame: null,
      });
    for (const s of spans) {
      const start = Math.max(
        dayTime(day, s.start, input.timezone).getTime(),
        earliest,
      );
      const end = dayTime(day, s.end, input.timezone).getTime();
      if (end > start) out.push({ start, end, frame: s.frame });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Segments minus busy intervals. */
function subtract(segments: Segment[], busy: BusyInterval[]): Segment[] {
  const blocks = busy
    .map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  for (const seg of segments) {
    let pieces: Segment[] = [seg];
    for (const b of blocks) {
      if (b.end <= seg.start || b.start >= seg.end) continue;
      pieces = pieces.flatMap((p) => {
        if (b.end <= p.start || b.start >= p.end) return [p];
        const parts: Segment[] = [];
        if (b.start > p.start) parts.push({ ...p, end: b.start });
        if (b.end < p.end) parts.push({ ...p, start: b.end });
        return parts;
      });
    }
    for (const p of pieces) {
      const start = ceilToGrid(p.start);
      if (p.end - start >= GRID_MINUTES * MINUTE) out.push({ ...p, start });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Whether a frame's filters accept a task. Empty filters accept anything. */
export function frameAccepts(
  frame: Frame,
  task: SchedulerTask,
  minutes: number,
) {
  const f = frame.filters;
  if (f.priorities.length && !f.priorities.includes(task.priority))
    return false;
  if (
    f.list_ids.length &&
    (!task.list_id || !f.list_ids.includes(task.list_id))
  )
    return false;
  if (f.tag_ids.length && !task.tag_ids.some((t) => f.tag_ids.includes(t)))
    return false;
  if (
    f.team_ids.length &&
    (!task.team_id || !f.team_ids.includes(task.team_id))
  )
    return false;
  if (f.min_minutes && minutes < f.min_minutes) return false;
  if (f.max_minutes && minutes > f.max_minutes) return false;
  return true;
}

/** Split `total` minutes into sessions of at most `max`, none shorter than `min`. */
export function sessions(
  total: number,
  split: boolean,
  max: number,
  min: number,
) {
  if (!split || total <= max) return [total];
  const out: number[] = [];
  let left = total;
  while (left > 0 && out.length < MAX_SESSIONS) {
    const next = Math.min(max, left);
    if (next < min && out.length) out[out.length - 1] += next;
    else out.push(next);
    left -= next;
  }
  return out;
}

export function schedule(input: SchedulerInput): SchedulerResult {
  let free = subtract(windows(input), input.busy);
  const capacity = free.reduce((sum, s) => sum + (s.end - s.start) / MINUTE, 0);
  const blocks: PlannedBlock[] = [];
  const unplaced: UnplacedTask[] = [];
  const atRisk: UnplacedTask[] = [];
  const pause = BREAK_MINUTES[input.breakLevel] * MINUTE;
  const lastDay = input.days.at(-1)!;
  const horizonEnd = dayTime(addDays(lastDay, 1), 0, input.timezone).getTime();

  const ranked = input.tasks
    .filter((t) => t.status !== "done")
    .map((t) => ({ task: t, score: priorityScore(t, input.now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task.due_at ?? "9999").localeCompare(b.task.due_at ?? "9999") ||
        a.task.title.localeCompare(b.task.title),
    );

  for (const { task, score } of ranked) {
    const unplace = (reason: string) =>
      unplaced.push({
        item_id: task.id,
        title: task.title,
        due_at: task.due_at,
        reason,
      });
    if (task.status === "blocked") {
      unplace("Blocked, so it wasn't planned.");
      continue;
    }
    const estimate = task.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES;
    const remaining = estimate - task.spent_minutes - task.scheduled_minutes;
    if (remaining <= 0) continue;
    const padded = roundUpMinutes(remaining * (1 + input.padPercent / 100));
    const parts = sessions(
      padded,
      input.split,
      input.splitAfterMinutes,
      input.minBlockMinutes,
    );
    const due = task.due_at ? Date.parse(task.due_at) : Infinity;
    const placed: PlannedBlock[] = [];
    let blockedByFrames = input.useFrames && input.frames.length > 0;
    let lateSession = false;
    let ok = true;
    for (const [index, minutes] of parts.entries()) {
      const need = minutes * MINUTE;
      const fits = (s: Segment) => {
        if (s.frame && !frameAccepts(s.frame, task, estimate)) return false;
        blockedByFrames = false;
        return s.end - s.start >= need;
      };
      // Earliest slot that ends by the due time; otherwise the earliest at all.
      const candidates = free.filter(fits);
      const onTime = candidates.find((s) => s.start + need <= due);
      const slot = onTime ?? candidates[0];
      if (!slot) {
        ok = false;
        break;
      }
      if (!onTime) lateSession = true;
      const start = slot.start;
      const end = start + need;
      placed.push({
        item_id: task.id,
        title: task.title,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        frame_id: slot.frame?.id ?? null,
        frame_name: slot.frame?.name ?? null,
        part: index + 1,
        parts: parts.length,
        score,
      });
      // Take the time (and a break after longer sessions) out of what's free.
      const taken = end + (minutes >= 45 ? pause : 0);
      free = free.flatMap((s) => {
        if (s !== slot) return [s];
        return taken < s.end ? [{ ...s, start: ceilToGrid(taken) }] : [];
      });
    }
    if (!ok) {
      unplace(
        blockedByFrames
          ? "No frame takes this task; adjust a frame's filters or plan without frames."
          : placed.length
            ? `Only ${placed.length} of ${parts.length} sessions fit in the free time.`
            : "Not enough free time in the days planned.",
      );
      // A partial placement still helps: keep the sessions that fit.
      blocks.push(...placed);
      if (task.due_at && due <= horizonEnd)
        atRisk.push({
          item_id: task.id,
          title: task.title,
          due_at: task.due_at,
          reason: "Can't get enough time before it's due.",
        });
      continue;
    }
    blocks.push(...placed);
    if (lateSession && task.due_at)
      atRisk.push({
        item_id: task.id,
        title: task.title,
        due_at: task.due_at,
        reason: "The time found runs past the due time.",
      });
  }

  blocks.sort((a, b) => a.start_at.localeCompare(b.start_at));
  const planned = blocks.reduce(
    (sum, b) => sum + (Date.parse(b.end_at) - Date.parse(b.start_at)) / MINUTE,
    0,
  );
  return {
    blocks,
    unplaced,
    at_risk: atRisk,
    capacity_minutes: Math.round(capacity),
    planned_minutes: Math.round(planned),
  };
}
