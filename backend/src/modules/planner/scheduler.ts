import {
  addDays,
  atRiskReason,
  clockMinutes,
  dayTime,
  DEFAULT_ESTIMATE_MINUTES,
  isClosed,
  priorityScore,
  remainingOf,
  rhythmFit,
  taskDemand,
  weekdayOf,
  zonedParts,
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
  /**
   * The moment it's due by (`deadlineOf`: the end of the day for an all-day
   * task, the end time for a task with one). `due_at` when not given.
   */
  deadline_at?: string | null;
  estimate_minutes: number | null;
  spent_minutes: number;
  /**
   * Time still to come already set aside for this task that counts: ending
   * by its deadline, or any once the deadline has passed (catch-up) or
   * without one (see `splitSessions`). Time after the deadline doesn't.
   */
  scheduled_minutes: number;
  /**
   * Its sessions that end after a deadline still ahead and haven't started:
   * the planner offers to move them to free time before the deadline.
   */
  late_sessions?: LateSession[];
  /**
   * Minutes still to come in its sessions after a deadline still ahead
   * (those that have started too). What stays there after the moves already
   * holds time for the task, so no more is added after the deadline.
   */
  late_minutes?: number;
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

/** A session after its task's deadline, which a plan may move before it. */
export type LateSession = {
  id: string;
  start_at: string;
  end_at: string;
  source: "manual" | "planner";
};

/** A late session the planner would move to free time before the deadline. */
export type ScheduledMove = {
  block_id: string;
  item_id: string;
  title: string;
  from_start_at: string;
  from_end_at: string;
  start_at: string;
  end_at: string;
  source: "manual" | "planner";
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
  /**
   * Learned placement. Without it every session takes the earliest time that
   * fits; with it each session takes the best-scoring time (see `placementCost`).
   */
  smart?: SmartPlacement;
};

/** What the planner has learned about someone, for choosing times. */
export type SmartPlacement = {
  /** Per local hour 0–23, -1…1, already scaled by confidence (see learnRhythm). */
  rhythm?: number[] | null;
  /** The best two hours, for the plan's summary. */
  peak?: { start_hour: number; end_hour: number } | null;
  /** Minutes of task time a day usually gets through; days past it cost more. */
  dayMinutes?: number | null;
  /** Put related tasks (same list or a shared tag) next to each other. */
  batch?: boolean;
};

export type SchedulerResult = {
  blocks: PlannedBlock[];
  unplaced: UnplacedTask[];
  at_risk: UnplacedTask[];
  /** Late sessions moved to free time before their deadline. */
  moves?: ScheduledMove[];
  capacity_minutes: number;
  planned_minutes: number;
  /** What the learned placement did, in words, for the plan's summary. */
  notes?: string[];
};

// One rule for what a task still needs, shared with the apps (core `fit.ts`).
export { DEFAULT_ESTIMATE_MINUTES, remainingOf };
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

const clock = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;
const hoursText = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

/** What learned placement did, in a sentence or two. */
function smartNotes(
  blocks: PlannedBlock[],
  tasks: Map<string, SchedulerTask>,
  smart: SmartPlacement,
  local: (ms: number) => { day: string; hour: number; weekday: number },
): string[] {
  const notes: string[] = [];
  const peak = smart.peak;
  if (peak) {
    const inPeak = blocks.filter((b) => {
      const t = tasks.get(b.item_id);
      if (!t || b.pinned) return false;
      const minutes = (Date.parse(b.end_at) - Date.parse(b.start_at)) / MINUTE;
      const h = local(Date.parse(b.start_at)).hour;
      return (
        taskDemand({ priority: t.priority, minutes }) >= 0.6 &&
        h >= peak.start_hour &&
        h < peak.end_hour
      );
    });
    if (inPeak.length)
      notes.push(
        `${list([...new Set(inPeak.map((b) => b.title))])} ${inPeak.length === 1 ? "is" : "are"} in your best hours (${clock(peak.start_hour)}–${clock(peak.end_hour)}).`,
      );
  }
  if (smart.dayMinutes) {
    const byDay = new Map<string, { minutes: number; weekday: number }>();
    for (const b of blocks) {
      const at = local(Date.parse(b.start_at));
      const d = byDay.get(at.day) ?? { minutes: 0, weekday: at.weekday };
      d.minutes += (Date.parse(b.end_at) - Date.parse(b.start_at)) / MINUTE;
      byDay.set(at.day, d);
    }
    const heavy = [...byDay.values()]
      .filter((d) => d.minutes > smart.dayMinutes! * 1.15)
      .sort((a, b) => b.minutes - a.minutes)[0];
    if (heavy)
      notes.push(
        `${WEEKDAYS[heavy.weekday]} has ${hoursText(heavy.minutes)} of tasks, more than the ${hoursText(smart.dayMinutes)} you usually get through.`,
      );
  }
  return notes;
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

const HOUR = 60 * MINUTE;
/** Later sessions are tried at these steps within a free stretch. */
const STEP_MINUTES = 30;
/** Blocks closer than this count as back to back, for batching. */
const ADJACENT = 20 * MINUTE;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * How pressed for time a task is, 0–1, by its slack: the free time before it's
 * due minus the time it still needs (least-slack first). A large task due on
 * Friday can be more pressing than a small one due tomorrow.
 */
export function slackUrgency(
  freeBeforeDueMinutes: number,
  remainingMinutes: number,
) {
  if (remainingMinutes <= 0) return 0;
  const slack = freeBeforeDueMinutes - remainingMinutes;
  return Math.min(1, Math.max(0, 1 - slack / (remainingMinutes + 240)));
}

/** When a task is due by, as a timestamp (Infinity without a date). */
const deadlineMs = (t: Pick<SchedulerTask, "due_at" | "deadline_at">) => {
  const at = t.deadline_at ?? t.due_at;
  return at ? Date.parse(at) : Infinity;
};

/** Free minutes in `free` between `from` and `to`. */
const freeBetween = (free: Segment[], from: number, to: number) =>
  free.reduce(
    (n, s) => n + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)),
    0,
  ) / MINUTE;

export function schedule(input: SchedulerInput): SchedulerResult {
  let free = subtract(windows(input), input.busy);
  const capacity = free.reduce((sum, s) => sum + (s.end - s.start) / MINUTE, 0);
  const slot = largestFree(free, input);
  const blocks: PlannedBlock[] = [];
  const unplaced: UnplacedTask[] = [];
  const atRisk: UnplacedTask[] = [];
  const moves: ScheduledMove[] = [];
  /** Moved sessions at their new times, for the day's load and batching. */
  const movedBlocks: PlannedBlock[] = [];
  const pause = BREAK_MINUTES[input.breakLevel] * MINUTE;
  const lastDay = input.days.at(-1)!;
  const horizonEnd = dayTime(addDays(lastDay, 1), 0, input.timezone).getTime();
  const scoreOf = (t: SchedulerTask) => priorityScore(t, input.now, slot);
  // Local day and clock time of an instant, cached (the planner asks often).
  const zoneCache = new Map<
    number,
    { day: string; hour: number; minute: number; weekday: number }
  >();
  const local = (ms: number) => {
    let hit = zoneCache.get(ms);
    if (!hit) {
      const p = zonedParts(new Date(ms), input.timezone);
      hit = {
        day: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
        hour: p.hour,
        minute: p.minute,
        weekday: p.weekday,
      };
      zoneCache.set(ms, hit);
    }
    return hit;
  };
  const dayIndex = (day: string) =>
    Math.round(
      (Date.parse(`${day}T00:00:00Z`) -
        Date.parse(`${input.days[0]}T00:00:00Z`)) /
        86_400_000,
    );

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

  const smart = input.smart;
  // With learned placement, tasks are also ranked by slack, so big work due
  // later starts before small work due sooner when it has to.
  const urgencyOf = new Map<string, number>();
  if (smart)
    for (const t of input.tasks) {
      if (!t.due_at || isClosed(t.status)) continue;
      const need =
        (remainingOf(t) -
          t.scheduled_minutes -
          (pinnedMinutes.get(t.id) ?? 0)) *
        (1 + input.padPercent / 100);
      urgencyOf.set(
        t.id,
        slackUrgency(
          freeBetween(free, input.now.getTime(), deadlineMs(t)),
          need,
        ),
      );
    }
  const rankedByScore = input.tasks
    .filter((t) => !isClosed(t.status))
    .map((t) => ({
      task: t,
      score: scoreOf(t),
      rank: scoreOf(t) + 2 * (urgencyOf.get(t.id) ?? 0),
    }))
    .sort(
      (a, b) =>
        b.rank - a.rank ||
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
    // Only time that ends by the deadline counts as set aside (see
    // `scheduled_minutes`), so a late session leaves this much still to plan.
    const remaining =
      remainingOf(task) -
      task.scheduled_minutes -
      (pinnedMinutes.get(task.id) ?? 0);
    if (remaining <= 0) {
      completed.set(task.id, finish());
      continue;
    }
    const due = deadlineMs(task);
    const nowMs = input.now.getTime();
    const accepts = (s: Segment) =>
      !s.frame || frameAccepts(s.frame, task, estimate);
    // The free time there is for it before its deadline, as its turn comes:
    // what "Needs 2 h more, with 45 min free" compares with.
    const freeBefore = Math.round(
      freeBetween(free.filter(accepts), Math.max(nowMs, ready), due),
    );
    const placed: PlannedBlock[] = [];
    let blockedByFrames = input.useFrames && input.frames.length > 0;
    let lateSession = false;
    let ok = true;
    // Earliest slot that ends by the due time; otherwise (unless `onTimeOnly`)
    // the earliest at all.
    const earliestPlace = (
      candidates: Segment[],
      need: number,
      onTimeOnly = false,
    ) => {
      const onTime = candidates.find(
        (s) => Math.max(s.start, ready) + need <= due,
      );
      const slot = onTime ?? (onTimeOnly ? undefined : candidates[0]);
      return slot ? { slot, start: Math.max(slot.start, ready) } : null;
    };
    // The best-scoring start among the free stretches, on time if possible
    // (and only on time with `onTimeOnly`).
    const bestPlace = (
      candidates: Segment[],
      need: number,
      minutes: number,
      onTimeOnly = false,
    ) => {
      const options: { slot: Segment; start: number }[] = [];
      for (const slot of candidates) {
        const first = Math.max(slot.start, ready);
        const last = slot.end - need;
        options.push({ slot, start: first });
        const step = STEP_MINUTES * MINUTE;
        for (let t = Math.ceil((first + 1) / step) * step; t < last; t += step)
          options.push({ slot, start: t });
        if (last > first) options.push({ slot, start: last });
      }
      const onTime = options.filter((o) => o.start + need <= due);
      const pool = onTime.length || onTimeOnly ? onTime : options;
      if (!pool.length) return null;
      // The earliest option on each day: lateness within a day counts from it.
      const firstOn = new Map<string, number>();
      for (const o of pool) {
        const day = local(o.start).day;
        firstOn.set(day, Math.min(firstOn.get(day) ?? Infinity, o.start));
      }
      const earliest = Math.min(...pool.map((o) => o.start));
      let best = pool[0];
      let bestCost = Infinity;
      for (const o of pool) {
        const c = placementCost(
          o.slot,
          o.start,
          need,
          minutes,
          earliest,
          firstOn.get(local(o.start).day)!,
        );
        if (
          c < bestCost - 1e-9 ||
          (Math.abs(c - bestCost) < 1e-9 && o.start < best.start)
        ) {
          best = o;
          bestCost = c;
        }
      }
      return best;
    };
    const demandOf = (minutes: number) =>
      taskDemand({ priority: task.priority, minutes });
    const pressed = 1 + 2 * (urgencyOf.get(task.id) ?? 0);
    /**
     * How good a start is; lower is better. Sooner is better (much more so
     * for pressing tasks; a day later costs 0.8, each hour later in a day
     * 0.1);
     * demanding work gains in hours that usually go well and light work
     * leaves them free; a session next to related work gains (fewer
     * switches); leaving a gap too short to use costs; and so does going past
     * the minutes a day usually gets through.
     */
    const placementCost = (
      slot: Segment,
      start: number,
      need: number,
      minutes: number,
      earliest: number,
      firstThatDay: number,
    ) => {
      const end = start + need;
      const here = local(start);
      const firstDay = local(earliest).day;
      const daysLater = Math.max(0, dayIndex(here.day) - dayIndex(firstDay));
      let cost =
        pressed *
        (0.8 * daysLater + 0.1 * Math.min(8, (start - firstThatDay) / HOUR));
      if (smart?.rhythm)
        cost -=
          1.2 *
          (demandOf(minutes) - 0.4) *
          rhythmFit(smart.rhythm, 1, here.hour, here.minute, minutes);
      const before = start - Math.max(slot.start, ready);
      const after = slot.end - end - (minutes >= 45 ? pause : 0);
      const unusable = input.minBlockMinutes * MINUTE;
      if (before > 0 && before < unusable) cost += 0.2;
      if (after > 0 && after < unusable) cost += 0.2;
      if (smart?.batch && (task.list_id || task.tag_ids.length)) {
        const related = [...blocks, ...movedBlocks, ...placed].some((b) => {
          if (b.item_id === task.id) return false;
          const other = byId.get(b.item_id);
          if (!other) return false;
          const touches =
            Math.abs(Date.parse(b.end_at) - start) <= ADJACENT + pause ||
            Math.abs(Date.parse(b.start_at) - end) <= ADJACENT + pause;
          return (
            touches &&
            ((!!task.list_id && other.list_id === task.list_id) ||
              other.tag_ids.some((t) => task.tag_ids.includes(t)))
          );
        });
        if (related) cost -= 0.3;
      }
      if (smart?.dayMinutes) {
        const load = [...blocks, ...movedBlocks, ...placed]
          .filter((b) => local(Date.parse(b.start_at)).day === here.day)
          .reduce(
            (n, b) =>
              n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / MINUTE,
            0,
          );
        const cap = smart.dayMinutes;
        const over =
          Math.max(0, load + minutes - cap) - Math.max(0, load - cap);
        // An hour past the usual day outweighs moving to the next day,
        // unless the task is pressing.
        cost += (3 * over) / 60;
      }
      return cost;
    };
    /** Take a session's time (and a break after longer ones) out of what's free. */
    const take = (
      slot: Segment,
      start: number,
      end: number,
      minutes: number,
    ) => {
      const taken = end + (minutes >= 45 ? pause : 0);
      free = free.flatMap((s) => {
        if (s !== slot) return [s];
        return [
          ...(s.start < start ? [{ ...s, end: start }] : []),
          ...(taken < s.end ? [{ ...s, start: ceilToGrid(taken) }] : []),
        ];
      });
    };
    // At risk: it can't get what it still needs before the deadline. Past
    // the deadline, time found is catch-up and nothing is flagged.
    const flagAtRisk = () => {
      if (!task.due_at || due <= nowMs) return;
      atRisk.push({
        item_id: task.id,
        title: task.title,
        due_at: task.due_at,
        reason: atRiskReason(remaining, freeBefore),
        remaining_minutes: Math.round(remaining),
        free_minutes: freeBefore,
      });
    };

    // Its sessions after the deadline first: each one moved to free time
    // before the deadline covers its own length. One that can't move stays
    // where it is (nothing is refused), and doesn't count.
    let left = remaining;
    let movedMinutes = 0;
    if (due > nowMs)
      for (const late of task.late_sessions ?? []) {
        if (left <= 0) break;
        const from = Date.parse(late.start_at);
        const length = Date.parse(late.end_at) - from;
        const minutes = length / MINUTE;
        const candidates = free.filter(
          (s) => accepts(s) && s.end - Math.max(s.start, ready) >= length,
        );
        const choice = smart
          ? bestPlace(candidates, length, minutes, true)
          : earliestPlace(candidates, length, true);
        if (!choice) continue;
        const { slot, start } = choice;
        const move: ScheduledMove = {
          block_id: late.id,
          item_id: task.id,
          title: task.title,
          from_start_at: new Date(from).toISOString(),
          from_end_at: new Date(from + length).toISOString(),
          start_at: new Date(start).toISOString(),
          end_at: new Date(start + length).toISOString(),
          source: late.source,
        };
        moves.push(move);
        movedBlocks.push({
          item_id: task.id,
          title: task.title,
          start_at: move.start_at,
          end_at: move.end_at,
          frame_id: slot.frame?.id ?? null,
          frame_name: slot.frame?.name ?? null,
          part: 1,
          parts: 1,
          score,
        });
        take(slot, start, start + length, minutes);
        left -= minutes;
        movedMinutes += minutes;
      }
    if (left <= 0) {
      completed.set(task.id, finish());
      continue;
    }
    // The late sessions that stay already hold this much time after the
    // deadline: new time goes before it, and only what they don't hold is
    // added after it. Otherwise each plan would add the same late time again.
    let heldLate =
      due > nowMs
        ? Math.max(
            0,
            (task.late_minutes ??
              (task.late_sessions ?? []).reduce(
                (n, l) =>
                  n + (Date.parse(l.end_at) - Date.parse(l.start_at)) / MINUTE,
                0,
              )) - movedMinutes,
          )
        : 0;

    const padded = roundUpMinutes(left * (1 + input.padPercent / 100));
    const parts = sessions(
      padded,
      input.split,
      input.splitAfterMinutes,
      input.minBlockMinutes,
    );
    for (const [index, part] of parts.entries()) {
      let minutes = part;
      let need = minutes * MINUTE;
      const fits = (s: Segment) => {
        if (!accepts(s)) return false;
        blockedByFrames = false;
        return s.end - Math.max(s.start, ready) >= need;
      };
      let candidates = free.filter(fits);
      let choice = smart
        ? bestPlace(candidates, need, minutes, heldLate > 0)
        : earliestPlace(candidates, need, heldLate > 0);
      if (!choice && heldLate > 0) {
        // No room before the deadline: a late session that stays holds it.
        lateSession = true;
        if (heldLate >= minutes) {
          heldLate -= minutes;
          continue;
        }
        // Partly held: only the rest is added.
        minutes = Math.max(input.minBlockMinutes, minutes - heldLate);
        need = minutes * MINUTE;
        heldLate = 0;
        candidates = free.filter(fits);
        choice = smart
          ? bestPlace(candidates, need, minutes)
          : earliestPlace(candidates, need);
      }
      if (!choice) {
        ok = false;
        break;
      }
      const { slot, start } = choice;
      if (start + need > due) lateSession = true;
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
      take(slot, start, end, minutes);
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
      if (due <= horizonEnd) flagAtRisk();
      continue;
    }
    blocks.push(...placed);
    completed.set(task.id, finish());
    if (lateSession) flagAtRisk();
  }

  blocks.sort((a, b) => a.start_at.localeCompare(b.start_at));
  // Number each task's sessions in time order: a short later session can
  // take a gap before a longer one, and pinned blocks count too.
  for (const id of new Set(blocks.map((b) => b.item_id))) {
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
    moves,
    capacity_minutes: Math.round(capacity),
    planned_minutes: Math.round(planned),
    ...(smart ? { notes: smartNotes(blocks, byId, smart, local) } : {}),
  };
}
