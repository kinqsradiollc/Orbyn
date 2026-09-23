import {
  addDays,
  clockMinutes,
  dayTime,
  isClosed,
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
import { frameSpans } from "./frames.js";

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
  /** Open subtasks, and the minutes they still need between them. */
  open_children?: number;
  children_remaining?: number;
  /** Prerequisites, with a known finish when already completed or fully scheduled. */
  dependencies?: { id: string; ready_at: string | null }[];
  scheduled_end_at?: string | null;
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
  /**
   * Blocks the user pinned while tuning a plan. They stay exactly where they
   * are, take their time out of what's free, and count towards their task.
   */
  pinned?: { item_id: string; start_at: string; end_at: string }[];
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

/**
 * Minutes a task still needs for itself (before time already set aside).
 * A task's estimate covers its subtasks: while it has open subtasks, they
 * are planned on their own, and the parent keeps only what its estimate has
 * beyond theirs (nothing when it has no estimate). So the work counted is
 * the sum of the subtasks' remaining estimates or the parent's own,
 * whichever is more, and never twice.
 */
export function remainingOf(t: {
  estimate_minutes: number | null;
  spent_minutes: number;
  open_children?: number;
  children_remaining?: number;
}) {
  if (t.open_children)
    return t.estimate_minutes == null
      ? 0
      : Math.max(
          0,
          t.estimate_minutes - t.spent_minutes - (t.children_remaining ?? 0),
        );
  return Math.max(
    0,
    (t.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES) - t.spent_minutes,
  );
}
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
  if (input.useFrames && input.frames.length) {
    // Frames repeat by weekday or by rule, skip dates, and may keep their own zone.
    const from = dayTime(input.days[0], 0, input.timezone).getTime();
    const to = dayTime(
      addDays(input.days.at(-1)!, 1),
      0,
      input.timezone,
    ).getTime();
    for (const f of input.frames)
      for (const s of frameSpans(f, from, to, input.timezone)) {
        const start = Math.max(s.start, earliest);
        if (s.end > start) out.push({ start, end: s.end, frame: f });
      }
    return out.sort((a, b) => a.start - b.start);
  }
  for (const day of input.days) {
    if (!input.workDays.includes(weekdayOf(day))) continue;
    const start = Math.max(
      dayTime(day, clockMinutes(input.workStart), input.timezone).getTime(),
      earliest,
    );
    const end = dayTime(
      day,
      clockMinutes(input.workEnd),
      input.timezone,
    ).getTime();
    if (end > start) out.push({ start, end, frame: null });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The longest free stretch, in minutes, on the first planned day that has
 * any free time: the size term of the priority score compares estimates
 * with it.
 */
function largestFree(free: Segment[], input: SchedulerInput) {
  for (const day of input.days) {
    const start = dayTime(day, 0, input.timezone).getTime();
    const end = dayTime(addDays(day, 1), 0, input.timezone).getTime();
    const lengths = free
      .filter((s) => s.start < end && s.end > start)
      .map((s) => (Math.min(s.end, end) - Math.max(s.start, start)) / MINUTE);
    if (lengths.length) return Math.max(...lengths);
  }
  return 0;
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

/** Titles as a sentence: "A", "A and B", "A, B and C". */
function list(titles: string[]): string {
  const shown = titles.slice(0, 3);
  const rest = titles.length - shown.length;
  const joined =
    shown.length > 1
      ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
      : shown[0];
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

export function schedule(input: SchedulerInput): SchedulerResult {
  let free = subtract(windows(input), input.busy);
  const capacity = free.reduce((sum, s) => sum + (s.end - s.start) / MINUTE, 0);
  const slot = largestFree(free, input);
  const blocks: PlannedBlock[] = [];
  const unplaced: UnplacedTask[] = [];
  const atRisk: UnplacedTask[] = [];
  const pause = BREAK_MINUTES[input.breakLevel] * MINUTE;
  const lastDay = input.days.at(-1)!;
  const horizonEnd = dayTime(addDays(lastDay, 1), 0, input.timezone).getTime();
  const scoreOf = (t: SchedulerTask) => priorityScore(t, input.now, slot);

  // Pinned blocks stay put: they take their time out of what's free (not out
  // of the capacity, which they use) and count towards their task.
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const pinnedMinutes = new Map<string, number>();
  const pinned = (input.pinned ?? []).filter((p) => byId.has(p.item_id));
  for (const p of pinned) {
    const task = byId.get(p.item_id)!;
    const minutes = (Date.parse(p.end_at) - Date.parse(p.start_at)) / MINUTE;
    pinnedMinutes.set(task.id, (pinnedMinutes.get(task.id) ?? 0) + minutes);
    blocks.push({
      item_id: task.id,
      title: task.title,
      start_at: new Date(p.start_at).toISOString(),
      end_at: new Date(p.end_at).toISOString(),
      frame_id: null,
      frame_name: null,
      part: 1,
      parts: 1,
      score: scoreOf(task),
      pinned: true,
    });
  }
  if (pinned.length) free = subtract(free, pinned);

  const rankedByScore = input.tasks
    .filter((t) => !isClosed(t.status))
    .map((t) => ({ task: t, score: scoreOf(t) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task.due_at ?? "9999").localeCompare(b.task.due_at ?? "9999") ||
        a.task.title.localeCompare(b.task.title),
    );

  const ranked: typeof rankedByScore = [];
  const pending = [...rankedByScore];
  const visited = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex(({ task }) =>
      (task.dependencies ?? []).every(
        (d) =>
          !byId.has(d.id) ||
          visited.has(d.id) ||
          isClosed(byId.get(d.id)!.status),
      ),
    );
    if (index < 0) {
      ranked.push(...pending);
      break;
    }
    const [next] = pending.splice(index, 1);
    ranked.push(next);
    visited.add(next.task.id);
  }
  const completed = new Map<string, number>(
    input.tasks
      .filter((t) => t.status === "done")
      .map((t) => [t.id, input.now.getTime()]),
  );
  for (const { task, score } of ranked) {
    const unplace = (reason: string) =>
      unplaced.push({
        item_id: task.id,
        title: task.title,
        due_at: task.due_at,
        reason,
      });
    const waitingOn = (task.dependencies ?? []).map((d) => ({
      id: d.id,
      end: byId.has(d.id)
        ? completed.get(d.id)
        : d.ready_at
          ? Date.parse(d.ready_at)
          : undefined,
    }));
    const ends = waitingOn.map((d) => d.end);
    const ready = Math.max(
      input.now.getTime(),
      ...ends.filter((t): t is number => t !== undefined),
    );
    const ownPins = pinned.filter((p) => p.item_id === task.id);
    // Say which task is in the way. "A prerequisite is not fully scheduled"
    // leaves someone looking at a task they cannot plan with no way to find
    // out what they have to plan first.
    const blocking = waitingOn
      .filter((d) => d.end === undefined || !Number.isFinite(d.end))
      .map((d) => byId.get(d.id)?.title)
      .filter((title): title is string => !!title);
    if (ends.some((t) => t === undefined || !Number.isFinite(t))) {
      for (let i = blocks.length - 1; i >= 0; i--)
        if (blocks[i].item_id === task.id) blocks.splice(i, 1);
      unplace(
        blocking.length
          ? `Waiting on ${list(blocking)}, which ${blocking.length === 1 ? "isn't" : "aren't"} fully scheduled yet.`
          : "Waiting on a task that isn't fully scheduled yet.",
      );
      continue;
    }
    if (ownPins.some((p) => Date.parse(p.start_at) < ready)) {
      for (let i = blocks.length - 1; i >= 0; i--)
        if (blocks[i].item_id === task.id) blocks.splice(i, 1);
      unplace("A pinned session starts before what it waits on finishes.");
      continue;
    }
    const finish = () =>
      Math.max(
        ready,
        task.scheduled_end_at ? Date.parse(task.scheduled_end_at) : ready,
        ...blocks
          .filter((b) => b.item_id === task.id)
          .map((b) => Date.parse(b.end_at)),
      );
    if (task.status === "blocked") {
      if (!pinnedMinutes.has(task.id))
        unplace("Blocked, so it wasn't planned.");
      continue;
    }
    const estimate = task.estimate_minutes ?? DEFAULT_ESTIMATE_MINUTES;
    const remaining =
      remainingOf(task) -
      task.scheduled_minutes -
      (pinnedMinutes.get(task.id) ?? 0);
    if (remaining <= 0) {
      completed.set(task.id, finish());
      continue;
    }
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
        return s.end - Math.max(s.start, ready) >= need;
      };
      // Earliest slot that ends by the due time; otherwise the earliest at all.
      const candidates = free.filter(fits);
      const onTime = candidates.find(
        (s) => Math.max(s.start, ready) + need <= due,
      );
      const slot = onTime ?? candidates[0];
      if (!slot) {
        ok = false;
        break;
      }
      if (!onTime) lateSession = true;
      const start = Math.max(slot.start, ready);
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
        return [
          ...(s.start < start ? [{ ...s, end: start }] : []),
          ...(taken < s.end ? [{ ...s, start: ceilToGrid(taken) }] : []),
        ];
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
    completed.set(task.id, finish());
    if (lateSession && task.due_at)
      atRisk.push({
        item_id: task.id,
        title: task.title,
        due_at: task.due_at,
        reason: "The time found runs past the due time.",
      });
  }

  blocks.sort((a, b) => a.start_at.localeCompare(b.start_at));
  // Number the sessions of tasks with pinned blocks again, in time order.
  for (const id of pinnedMinutes.keys()) {
    const own = blocks.filter((b) => b.item_id === id);
    own.forEach((b, i) => {
      b.part = i + 1;
      b.parts = own.length;
    });
  }
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
