import { dueDayAt, localDateKey, type Item } from "@orbyn/core";
import type { Day } from "./agenda.js";

const clock = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });

/** The day as plain facts for the assistant: times already in the person's zone. */
export function agendaBriefFacts(full: Day, now: Date) {
  // Nothing from a project kept out of the assistant is sent to it.
  const out = (id: string | null | undefined) => !!id && full.keptOut.has(id);
  const day: Day = {
    ...full,
    items: full.items.filter((i) => !out(i.id)),
    calendar: full.calendar.filter((e) => !out(e.item_id)),
    setAside: full.setAside.filter((b) => !out(b.item_id)),
    comingEvents: full.comingEvents.filter((e) => !out(e.item_id)),
    priorities: full.aiPriorities,
    study: full.aiStudy ?? null,
  };
  const today = localDateKey(now, day.tz);
  // The day each task is due by (`dueDayAt`): an all-day task is due today
  // until the day is over.
  const dueDay = (i: Item) => localDateKey(dueDayAt(i)!, day.tz);
  const due = day.items.filter(
    (i) =>
      i.status !== "done" && i.status !== "cancelled" && dueDay(i) === today,
  );
  const slipped = day.items.filter(
    (i) => i.status !== "done" && i.status !== "cancelled" && dueDay(i) < today,
  );
  return {
    now: clock(now.toISOString(), day.tz),
    calendar: day.calendar.slice(0, 20).map((e) => ({
      when: e.all_day
        ? "all day"
        : `${clock(e.start_at, day.tz)}–${clock(e.end_at, day.tz)}`,
      title: e.title.slice(0, 100),
    })),
    due_today: due.slice(0, 10).map((i) => i.title.slice(0, 100)),
    top_priorities: day.priorities.map((t) => t.slice(0, 100)),
    ...(day.study
      ? {
          study: {
            cards_to_review: day.study.due + day.study.newCards,
            exams: day.study.exams.map((e) => ({
              title: e.title.slice(0, 100),
              days_left: e.days_left,
            })),
          },
        }
      : {}),
    slipped: slipped.length,
    set_aside: day.setAside.slice(0, 8).map((b) => ({
      when: `${clock(b.start_at, day.tz)}–${clock(b.end_at, day.tz)}`,
      title: b.title.slice(0, 100),
    })),
    free_minutes_left: day.freeMinutes,
    coming_up: day.comingEvents.map((e) => ({
      title: e.title.slice(0, 100),
      day: localDateKey(new Date(e.start_at), day.tz),
    })),
  };
}
