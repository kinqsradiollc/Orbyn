import { hoursLabel, type WeekIssue, type WeekScene } from "@orbyn/core";

/** A day key at noon UTC, safe to format without shifting to another date. */
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

export const dayText = (day: string, options: Intl.DateTimeFormatOptions) =>
  noon(day).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });

export const dayShort = (day: string) =>
  dayText(day, { weekday: "short", day: "numeric" });
export const dayMedium = (day: string) =>
  dayText(day, { weekday: "short", day: "numeric", month: "short" });
export const dayLong = (day: string) =>
  dayText(day, { weekday: "long", day: "numeric", month: "long" });
export const weekdayName = (day: string) => dayText(day, { weekday: "long" });
export const monthName = (day: string) =>
  dayText(day, { month: "long", year: "numeric" });

export const timeLabel = (iso: string | Date, tz: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });

export const spanLabel = (start: string, end: string, tz: string) =>
  `${timeLabel(start, tz)} – ${timeLabel(end, tz)}`;

export const whenLabel = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });

export const clock = (minutes: number) => {
  const m = Math.max(0, Math.min(1439, minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** "13:00" or "1 PM", the way this person's locale writes hours. */
export const hourLabel = (hour: number) =>
  new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });

/** "Nov 2 – 8, 2026", "Oct 26 – Nov 1, 2026", or one full day. */
export function rangeTitle(days: string[]) {
  const first = days[0];
  const last = days[days.length - 1];
  if (days.length === 1)
    return dayText(first, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const start = dayText(first, { month: "short", day: "numeric" });
  const end = dayText(
    last,
    first.slice(0, 7) === last.slice(0, 7)
      ? { day: "numeric" }
      : { month: "short", day: "numeric" },
  );
  return `${start} – ${end}, ${last.slice(0, 4)}`;
}

export const minutesLabel = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return rest ? `${Math.floor(m / 60)} h ${rest} min` : `${m / 60} h`;
};

export const issueText = (issue: WeekIssue, scene: WeekScene) => {
  if (issue.kind === "over")
    return `${weekdayName(scene.days[issue.day].date)} is ${hoursLabel(issue.minutes)} over`;
  if (issue.kind === "late") return `${issue.title} ends after its deadline`;
  return `${issue.title} clashes with ${issue.with_title}`;
};

export const issueKey = (issue: WeekIssue) =>
  issue.kind === "over"
    ? `over-${issue.day}`
    : issue.kind === "late"
      ? `late-${issue.part_id}`
      : `clash-${issue.part_id}-${issue.with_id}`;

export const headline = (count: number) =>
  count === 0
    ? "This week fits"
    : count === 1
      ? "One thing to fix this week"
      : `${count} things to fix this week`;

export const zoneCity = (zone: string) =>
  (zone.split("/").pop() ?? zone).replaceAll("_", " ");

export function zoneAbbr(zone: string, at = new Date()) {
  try {
    return (
      new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        timeZoneName: "short",
      })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? zone
    );
  } catch {
    return zone;
  }
}
