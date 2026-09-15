/** "Sep 20, 9:00 AM" in the device locale, or "Anytime" for undated items. */
export const dateLabel = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Anytime";

export const sameDay = (a: Date, b: Date) =>
  a.toDateString() === b.toDateString();

/** ISO timestamp -> value for an HTML `datetime-local` input, in local time. */
export const toDateTimeLocal = (value: string | null | undefined) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";

/** `datetime-local` input value -> ISO timestamp, or null when empty. */
export const fromDateTimeLocal = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addMonths = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth() + n, 1);

/** Weeks of a month grid starting on Sunday, padded with days from adjacent months. */
export function monthGrid(month: Date): Date[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const weeks: Date[][] = [];
  const cursor = new Date(start);
  do {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() === month.getMonth());
  return weeks;
}
