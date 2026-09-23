import type { CalendarKind, CalendarSharing } from "./types.js";

export type CalendarKindDefaults = {
  label: string;
  /** One line for the picker: what it's for and what the defaults do. */
  hint: string;
  busy: boolean;
  all_day_busy: boolean;
  sharing: CalendarSharing;
  reminder_minutes: number | null;
};

/**
 * What each kind of subscribed calendar starts with. A calendar can hold
 * very different things — a class timetable, exams, shifts, meetings,
 * public holidays — and each wants different handling:
 *
 * - Timed events you attend (classes, work, meetings, exams) are busy, so
 *   the planner, booking pages and teammates work around them.
 * - Exams also block their whole day when they're all-day, and remind you
 *   the day before; meetings remind you ten minutes before.
 * - Holiday calendars are shown but don't count as busy: public-holiday
 *   feeds are full of observances that aren't days off. Turn on "Blocks the
 *   whole day" for a leave calendar.
 *
 * Teammates only ever see busy time, never titles; "hidden" keeps even that
 * to yourself.
 */
export const CALENDAR_KIND_DEFAULTS: Record<
  CalendarKind,
  CalendarKindDefaults
> = {
  classes: {
    label: "Classes",
    hint: "A timetable. Busy during each class.",
    busy: true,
    all_day_busy: false,
    sharing: "busy",
    reminder_minutes: null,
  },
  exams: {
    label: "Exams",
    hint: "Busy, all-day exams block the day, reminded the day before.",
    busy: true,
    all_day_busy: true,
    sharing: "busy",
    reminder_minutes: 1440,
  },
  work: {
    label: "Work",
    hint: "Shifts or a work calendar. Busy during each one.",
    busy: true,
    all_day_busy: false,
    sharing: "busy",
    reminder_minutes: null,
  },
  meetings: {
    label: "Meetings",
    hint: "Busy, reminded 10 minutes before.",
    busy: true,
    all_day_busy: false,
    sharing: "busy",
    reminder_minutes: 10,
  },
  holidays: {
    label: "Holidays & leave",
    hint: "Shown, not busy. Turn on “blocks the whole day” for leave.",
    busy: false,
    all_day_busy: false,
    sharing: "busy",
    reminder_minutes: null,
  },
  other: {
    label: "Other",
    hint: "Busy during each event.",
    busy: true,
    all_day_busy: false,
    sharing: "busy",
    reminder_minutes: null,
  },
};

/** Reminder choices offered in the apps, in minutes (null = none). */
export const CALENDAR_REMINDER_CHOICES: (number | null)[] = [
  null,
  5,
  10,
  15,
  30,
  60,
  1440,
];

/** "10 minutes before", "1 day before", "No reminders". */
export function reminderLabel(minutes: number | null): string {
  if (minutes == null) return "No reminders";
  if (minutes === 0) return "At the start";
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d === 1 ? "" : "s"} before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"} before`;
  }
  return `${minutes} minutes before`;
}

/**
 * Guess a kind from a calendar's name, so "COMP30024 timetable" starts as
 * classes. Only a suggestion for the add form.
 */
export function guessCalendarKind(name: string): CalendarKind {
  const n = name.toLowerCase();
  if (/\b(exams?|tests?|quiz(zes)?|assessments?|midterms?|finals?)\b/.test(n))
    return "exams";
  if (
    /\b(class(es)?|timetable|lectures?|tutorials?|courses?|semester|uni|university|school|s[12])\b/.test(
      n,
    )
  )
    return "classes";
  if (/\b(holidays?|leave|vacations?|pto|days? off)\b/.test(n))
    return "holidays";
  if (/\b(meetings?|standups?|calls?|1:1s?|syncs?)\b/.test(n))
    return "meetings";
  if (/\b(work|shifts?|roster|office|job)\b/.test(n)) return "work";
  return "other";
}
