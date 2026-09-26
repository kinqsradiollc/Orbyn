import { dueDayAt } from "./deadlines.js";
import { localDateKey } from "./time.js";
import type { Item } from "./types.js";

// The compact "glance" a home-screen widget or a Watch complication shows: how
// today looks at a glance, small enough to hand to a widget through shared
// storage. Pure and unit-tested; the native widget just renders these fields.

export type GlanceEvent = { title: string; at: string };

/**
 * A task a widget lists, to tick from the widget (CAP-06): overdue ones
 * first, then today's, then the next few due soon. `due` is its deadline.
 */
export type GlanceTask = {
  id: string;
  title: string;
  due: string | null;
  overdue: boolean;
  /** Its list's and project's names, for a widget set to one of them. */
  list: string | null;
  project: string | null;
};

/** How many tasks a glance lists: a large widget's worth. */
export const GLANCE_TASKS = 6;

export type Glance = {
  /** When this glance was computed (ISO instant). */
  updatedAt: string;
  /** Open tasks due today (not done). */
  todayOpen: number;
  /** Tasks due today already done. */
  todayDone: number;
  /** Open tasks whose deadline fell on a day before today. */
  overdue: number;
  /** The next event starting now or later, or null. */
  nextEvent: GlanceEvent | null;
  /** Tasks to tick from a widget, most pressing first (CAP-06). */
  tasks?: GlanceTask[];
};

const ACTIVE_EVENT = (s: string) => s !== "cancelled" && s !== "done";

/** Summarize a person's items into the widget/Watch glance payload. */
export function buildGlance(
  items: Item[],
  opts: {
    now?: Date;
    timeZone: string;
    /** Timed events from subscribed calendars (a class, a shift), for "next". */
    external?: { title: string; start_at: string; all_day: boolean }[];
    /** Names for lists and projects, so a widget can show just one. */
    lists?: { id: string; name: string }[];
    projects?: { id: string; name: string }[];
  },
): Glance {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone;
  const todayKey = localDateKey(now, tz);
  let todayOpen = 0;
  let todayDone = 0;
  let overdue = 0;
  let next: { title: string; at: string; ms: number } | null = null;
  const listed: (GlanceTask & { ms: number })[] = [];

  const names = (it: Item) => ({
    list: opts.lists?.find((l) => l.id === it.list_id)?.name ?? null,
    project: opts.projects?.find((p) => p.id === it.project_id)?.name ?? null,
  });
  for (const it of items) {
    // A task with no deadline can still be ticked from a widget, after the
    // ones with deadlines.
    if (
      !it.due_at &&
      it.kind === "task" &&
      it.status !== "done" &&
      it.status !== "cancelled"
    )
      listed.push({
        id: it.id,
        title: it.title,
        due: null,
        overdue: false,
        ...names(it),
        ms: Number.POSITIVE_INFINITY,
      });
    if (!it.due_at) continue;
    if (it.kind === "task") {
      // The deadline's day: an all-day task is due today until it's over.
      const deadline = dueDayAt(it)!;
      const dayKey = localDateKey(deadline, tz);
      if (it.status === "done") {
        if (dayKey === todayKey) todayDone++;
      } else if (dayKey === todayKey) {
        todayOpen++;
      } else if (dayKey < todayKey) {
        overdue++;
      }
      if (it.status !== "done" && it.status !== "cancelled")
        listed.push({
          id: it.id,
          title: it.title,
          due: deadline.toISOString(),
          overdue: dayKey < todayKey,
          ...names(it),
          ms: deadline.getTime(),
        });
    } else if (it.kind === "event" && ACTIVE_EVENT(it.status)) {
      const ms = new Date(it.due_at).getTime();
      if (ms >= now.getTime() && (!next || ms < next.ms))
        next = { title: it.title, at: it.due_at, ms };
    }
  }

  for (const e of opts.external ?? []) {
    if (e.all_day) continue;
    const ms = new Date(e.start_at).getTime();
    if (ms >= now.getTime() && (!next || ms < next.ms))
      next = { title: e.title, at: e.start_at, ms };
  }

  return {
    updatedAt: now.toISOString(),
    todayOpen,
    todayDone,
    overdue,
    nextEvent: next ? { title: next.title, at: next.at } : null,
    tasks: listed
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.ms - b.ms)
      .slice(0, GLANCE_TASKS)
      .map(({ ms: _ms, ...t }) => t),
  };
}
