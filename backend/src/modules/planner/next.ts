import {
  addDays,
  clockMinutes,
  dayTime,
  guessEstimate,
  learnedRatio,
  localDateKey,
  priorityScore,
  rhythmFit,
  taskDemand,
  weekdayOf,
  zonedParts,
  type UpNext,
  type UpNextSuggestion,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import {
  agendaEntries,
  busyIntervals,
  loadPrefs,
  timeBlocks,
} from "./calendar.js";
import { keptBlocks, loadLearning } from "./learning.js";
import { candidateTasks } from "./plans.js";
import { remainingOf } from "./scheduler.js";

/** How many suggestions "Up next" offers. */
const SUGGESTIONS = 3;
/** Blocks from this far back count when noticing work that keeps slipping. */
const SLIP_WINDOW_DAYS = 28;
/** A session that slipped this often is offered as a short start instead. */
const SLIPS_FOR_SHORT_START = 2;
const SHORT_START_MINUTES = 25;

const round5 = (m: number) => Math.max(5, Math.floor(m / 5) * 5);

const clockText = (at: Date, timezone: string) => {
  const p = zonedParts(at, timezone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** "today, 17:00", "tomorrow, 09:00", "Fri 26 Sept, 17:00" in the person's zone. */
export function whenText(iso: string, now: Date, timezone: string) {
  const at = new Date(iso);
  const day = localDateKey(at, timezone);
  const today = localDateKey(now, timezone);
  const time = clockText(at, timezone);
  if (day === today) return `today, ${time}`;
  if (day === addDays(today, 1)) return `tomorrow, ${time}`;
  if (day === addDays(today, -1)) return `yesterday, ${time}`;
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(at);
  return `${label}, ${time}`;
}

const minutesText = (m: number) => {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${m} min`;
};

/**
 * What to do now: the free time until the next event (or the end of the
 * working day), and up to three open tasks worth starting in it, each with
 * the reasons in words. A task with time set aside right now comes first.
 * Then tasks rank by the planner's priority score, lifted when they fit the
 * free time, when they're demanding and this hour usually goes well for the
 * person, and when they keep slipping (offered as a short first session:
 * starting is the hard part).
 *
 * A caller that sees only part of the person's work (an agent's
 * connection) passes `window`, the free time it worked out from what it
 * can see (null for none), and `reach`, which teams' tasks it may suggest;
 * then no minutes, reason or order depends on anything outside it.
 */
export async function upNext(
  db: Db,
  userId: string,
  now = new Date(),
  scope: {
    window?: UpNext["window"];
    reach?: (teamId: string | null) => boolean;
  } = {},
): Promise<UpNext> {
  const prefs = await loadPrefs(db, userId);
  const tz = prefs.timezone;
  const today = localDateKey(now, tz);
  const dayStart = dayTime(today, clockMinutes(prefs.work_start), tz);
  const dayEnd = dayTime(today, clockMinutes(prefs.work_end), tz);
  const working =
    prefs.work_days.includes(weekdayOf(today)) &&
    now >= dayStart &&
    now < dayEnd;

  const given = "window" in scope;
  const [busy, agenda, current, tasks, learning, slips] = await Promise.all([
    working && !given
      ? busyIntervals(db, userId, now, dayEnd, { blocks: false, derived: true })
      : Promise.resolve([]),
    working && !given
      ? agendaEntries(
          db,
          userId,
          now,
          new Date(dayEnd.getTime() + 2 * 3_600_000),
        )
      : Promise.resolve([]),
    timeBlocks(db, userId, now, new Date(now.getTime() + 1)),
    candidateTasks(db, userId),
    loadLearning(db, userId, tz, now),
    keptBlocks(
      db,
      userId,
      dayTime(addDays(today, -SLIP_WINDOW_DAYS), 0, tz),
      now,
      tz,
    ),
  ]);

  // The free stretch from now: none while an event is on.
  let window: UpNext["window"] = scope.window ?? null;
  const at = now.getTime();
  const sorted = busy
    .map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))
    .sort((a, b) => a.start - b.start);
  if (!given && working && !sorted.some((b) => b.start <= at && b.end > at)) {
    const next = sorted.find((b) => b.start > at);
    const end = Math.min(next?.start ?? Infinity, dayEnd.getTime());
    const minutes = Math.floor((end - at) / 60_000);
    if (minutes >= 5) {
      // Name the event that ends it (buffers and travel come before it).
      const event =
        next && next.start < dayEnd.getTime()
          ? agenda
              .filter((e) => e.busy && !e.all_day)
              .find((e) => {
                const s = Date.parse(e.start_at);
                return s >= end && s <= end + 90 * 60_000;
              })
          : undefined;
      window = {
        start_at: now.toISOString(),
        end_at: new Date(end).toISOString(),
        minutes,
        until: event?.title ?? null,
      };
    }
  }

  const plannedNow = new Map(
    current
      .filter((b) => Date.parse(b.start_at) <= at && Date.parse(b.end_at) > at)
      .map((b) => [b.item_id, b]),
  );
  // Past sessions that mostly didn't go into their task, per open task.
  const slipped = new Map<string, number>();
  for (const b of slips.blocks) {
    const minutes = (b.end_at.getTime() - b.start_at.getTime()) / 60_000;
    if (b.end_at.getTime() > at || b.kept >= minutes / 2) continue;
    slipped.set(b.item_id, (slipped.get(b.item_id) ?? 0) + 1);
  }

  const hourFit =
    prefs.learn_rhythm !== false
      ? rhythmFit(
          learning.rhythm.hours,
          learning.rhythm.confidence,
          zonedParts(now, tz).hour,
          0,
          60,
        )
      : 0;
  const ready = (d: { ready_at: string | null }) =>
    d.ready_at !== null && Date.parse(d.ready_at) <= at;

  const ranked: (UpNextSuggestion & { score: number })[] = [];
  for (const t of tasks) {
    if (scope.reach && !scope.reach(t.team_id)) continue;
    if (t.status === "blocked") continue;
    if (!(t.dependencies ?? []).every(ready)) continue;
    let estimate = t.estimate_minutes;
    if (prefs.learn_estimates) {
      if (estimate != null)
        estimate = Math.round(estimate * learnedRatio(t, learning.durations));
      else if (!t.open_children)
        estimate = guessEstimate(t, learning.durations)?.minutes ?? null;
    }
    const remaining = remainingOf({ ...t, estimate_minutes: estimate });
    const block = plannedNow.get(t.id);
    if (remaining <= 0 && !block) continue;

    const slips = slipped.get(t.id) ?? 0;
    let minutes = Math.min(remaining || 30, prefs.split_after_minutes);
    if (block) minutes = Math.round((Date.parse(block.end_at) - at) / 60_000);
    else if (window) minutes = Math.min(minutes, window.minutes);
    if (!block && slips >= SLIPS_FOR_SHORT_START)
      minutes = Math.min(minutes, SHORT_START_MINUTES);
    minutes = round5(minutes);

    const demand = taskDemand({ priority: t.priority, minutes });
    const fits = !!window && remaining <= window.minutes;
    let score = priorityScore(t, now, window?.minutes ?? null);
    if (block) score += 10;
    if (fits) score += 0.75;
    score += 1.2 * (demand - 0.4) * hourFit;
    if (slips >= SLIPS_FOR_SHORT_START) score += 0.3;

    const reasons: string[] = [];
    if (block)
      reasons.push(
        `Planned for now, until ${clockText(new Date(block.end_at), tz)}`,
      );
    if (t.due_at) {
      const due = Date.parse(t.due_at);
      if (due < at)
        reasons.push(`Overdue since ${whenText(t.due_at, now, tz)}`);
      else if (due - at < 7 * 86_400_000)
        reasons.push(`Due ${whenText(t.due_at, now, tz)}`);
    }
    if (slips >= SLIPS_FOR_SHORT_START && !block)
      reasons.push(
        `Planned ${slips} times without getting done: try ${minutes} minutes of it`,
      );
    if (fits && window)
      reasons.push(
        window.until
          ? `Fits the ${minutesText(window.minutes)} before ${window.until}`
          : `Fits the ${minutesText(window.minutes)} you have free`,
      );
    if (hourFit >= 0.25 && demand >= 0.6)
      reasons.push("Your focus usually goes well around now");
    if (t.status === "in_progress") reasons.push("Already started");
    if (t.priority === "high") reasons.push("High priority");
    if (!reasons.length) reasons.push("Next on your list");

    ranked.push({
      item_id: t.id,
      title: t.title,
      due_at: t.due_at,
      priority: t.priority,
      minutes,
      reasons: reasons.slice(0, 3),
      planned_now: !!block,
      score,
    });
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") ||
      a.title.localeCompare(b.title),
  );
  return {
    at: now.toISOString(),
    window,
    suggestions: ranked
      .slice(0, SUGGESTIONS)
      .map(({ score: _score, ...s }) => s),
  };
}
