import { localDateKey } from "./time.js";
import type { Item } from "./types.js";

// The compact "glance" a home-screen widget or a Watch complication shows: how
// today looks at a glance, small enough to hand to a widget through shared
// storage. Pure and unit-tested; the native widget just renders these fields.

export type GlanceEvent = { title: string; at: string };

export type Glance = {
  /** When this glance was computed (ISO instant). */
  updatedAt: string;
  /** Open tasks due today (not done). */
  todayOpen: number;
  /** Tasks due today already done. */
  todayDone: number;
  /** Open tasks whose day is before today. */
  overdue: number;
  /** The next event starting now or later, or null. */
  nextEvent: GlanceEvent | null;
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
  },
): Glance {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone;
  const todayKey = localDateKey(now, tz);
  let todayOpen = 0;
  let todayDone = 0;
  let overdue = 0;
  let next: { title: string; at: string; ms: number } | null = null;

  for (const it of items) {
    if (!it.due_at) continue;
    if (it.kind === "task") {
      const dayKey = localDateKey(new Date(it.due_at), tz);
      if (it.status === "done") {
        if (dayKey === todayKey) todayDone++;
      } else if (dayKey === todayKey) {
        todayOpen++;
      } else if (dayKey < todayKey) {
        overdue++;
      }
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
  };
}
