import { byDueDate, startOfDay, type Item } from "@orbyn/core";

/** Local date math for the calendar views. Weeks start on Sunday, like `monthGrid`. */

export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay());

/** Whole calendar days from `a` to `b` (DST-safe). */
export const daysBetween = (a: Date, b: Date) =>
  Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000,
  );

export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** Default length when an item has no end time. */
const defaultMinutes = (i: Item) => (i.kind === "event" ? 60 : 30);

/** Start and end of a dated item; items without an end get a default length. */
export function itemSpan(i: Item) {
  if (!i.due_at) return null;
  const start = new Date(i.due_at);
  const end = i.end_at
    ? new Date(i.end_at)
    : new Date(start.getTime() + defaultMinutes(i) * 60000);
  return { start, end };
}

/** First calendar day the item is on. */
export const firstDay = (i: Item) => startOfDay(new Date(i.due_at!));

/** Last calendar day the item touches; an end at exactly midnight belongs to the day before. */
export const lastDay = (i: Item) =>
  i.end_at && Date.parse(i.end_at) > Date.parse(i.due_at!)
    ? startOfDay(new Date(Date.parse(i.end_at) - 1))
    : firstDay(i);

/** Spans more than one calendar day (`due_at` → `end_at`). */
export const isMultiDay = (i: Item) =>
  !!i.due_at && lastDay(i).getTime() > firstDay(i).getTime();

/** No specific time: whole-day items (`all_day`) and items spanning several days. */
export const isAllDay = (i: Item) =>
  !!i.due_at && (!!i.all_day || isMultiDay(i));

/** The item is on `day` (including every day a multi-day item spans). */
export const isOnDay = (i: Item, day: Date) => {
  if (!i.due_at) return false;
  const d = startOfDay(day).getTime();
  return firstDay(i).getTime() <= d && d <= lastDay(i).getTime();
};

export const itemsForDay = (items: Item[], day: Date) =>
  items.filter((i) => isOnDay(i, day)).sort(byDueDate);

export const timeLabel = (d: Date) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Whether the user's locale shows 24-hour times (then hours read "13:00"). */
const uses24h = () => {
  const cycle = new Intl.DateTimeFormat([], {
    hour: "numeric",
  }).resolvedOptions().hourCycle;
  return cycle === "h23" || cycle === "h24";
};

/** Hour column label: "1 PM", or "13:00" in 24-hour locales. */
export const hourLabel = (h: number) =>
  uses24h()
    ? `${String(h).padStart(2, "0")}:00`
    : new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });

export const monthTitle = (d: Date) =>
  d.toLocaleDateString([], { month: "long", year: "numeric" });

/** "Sep 13 – 19, 2026", "Sep 28 – Oct 4, 2026", or a single day. */
export function rangeTitle(days: Date[]) {
  const first = days[0];
  const last = days[days.length - 1];
  if (days.length === 1)
    return first.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const sameMonth = first.getMonth() === last.getMonth();
  const start = first.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  const end = last.toLocaleDateString(
    [],
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  );
  return `${start} – ${end}, ${last.getFullYear()}`;
}
