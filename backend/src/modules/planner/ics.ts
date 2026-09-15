import { createHash } from "node:crypto";
import {
  addDays,
  dayTime,
  localDateKey,
  zonedParts,
  type AttendeeStatus,
  type OccurrenceChanges,
} from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";
import {
  busyIntervals,
  loadOverrides,
  occurrenceEnd,
  timeBlocks,
  type SeriesRow,
} from "./calendar.js";

/**
 * iCalendar (RFC 5545) for other calendar apps: someone's private feed of
 * dated items (with repeats, single-occurrence changes, alerts, free time and
 * invitees), a busy-only feed with no details, and the invitations emailed
 * to people invited to an event. Read-only: the data stays on this server.
 */
export type FeedItem = SeriesRow & {
  title: string;
  notes: string;
  status: string;
  location: string;
  meeting_url: string;
  busy: boolean;
  alerts: number[];
  updated_at: Date;
  version: number;
};

/** The item columns `FeedItem` needs, on alias `i`. */
export const FEED_COLUMNS = `i.id, i.title, i.notes, i.kind, i.status, i.due_at, i.end_at,
  i.location, i.meeting_url, i.rrule, i.timezone, i.series_start, i.exdates,
  i.updated_at, i.all_day, i.busy, i.alerts, i.version`;

export type CalendarPerson = {
  email: string;
  name: string;
  status?: AttendeeStatus;
};

const PARTSTAT: Record<AttendeeStatus, string> = {
  needs_action: "NEEDS-ACTION",
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentative: "TENTATIVE",
};

const text = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");

/** A parameter value: quoted, without the characters quotes can't hold. */
const param = (value: string) => `"${value.replace(/["\r\n]/g, "'")}"`;

const utc = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const local = (at: Date, timeZone: string) => {
  const p = zonedParts(at, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}${two(p.month)}${two(p.day)}T${two(p.hour)}${two(p.minute)}${two(p.second)}`;
};

const dateOnly = (at: Date, timeZone: string) =>
  localDateKey(at, timeZone).replaceAll("-", "");

/** Fold lines longer than 75 characters, as the format requires. */
function fold(line: string) {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += i === 0 ? 75 : 74)
    parts.push(chars.slice(i, i + (i === 0 ? 75 : 74)).join(""));
  return parts.join("\r\n ");
}

/** A task shows for this long when it has only a due time. */
const TASK_MINUTES = 15;
const EVENT_MINUTES = 30;

/**
 * An instant as the item's kind of time: a date for all-day items, local
 * time in its zone for repeating ones (so repeats follow daylight saving),
 * UTC otherwise.
 */
function timeProp(name: string, at: Date, r: FeedItem) {
  if (r.all_day) return `${name};VALUE=DATE:${dateOnly(at, r.timezone)}`;
  if (r.rrule) return `${name};TZID=${r.timezone}:${local(at, r.timezone)}`;
  return `${name}:${utc(at)}`;
}

/** An all-day series' UNTIL has to be a date too. */
const ruleFor = (r: FeedItem) =>
  r.all_day
    ? r.rrule!.replace(
        /UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/i,
        (_m, y, mo, d, h, mi, s) =>
          `UNTIL=${dateOnly(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), r.timezone)}`,
      )
    : r.rrule!;

export type EventOptions = {
  organizer?: CalendarPerson;
  attendees?: CalendarPerson[];
  /** STATUS:CANCELLED (an invitation that's called off). */
  cancelled?: boolean;
  /** VALARMs from the item's alerts (feeds; invitations leave alerts to each person). */
  alarms?: boolean;
  /** Occurrences changed on their own, as extra VEVENTs with RECURRENCE-ID. */
  overrides?: Map<number, OccurrenceChanges>;
};

/** The VEVENTs for one item: the item or series, then any changed occurrences. */
export function eventLines(r: FeedItem, o: EventOptions = {}): string[] {
  const out: string[] = [];
  // Without an end: the next midnight for all-day items, a short slot otherwise.
  const fallbackEnd = (start: Date) =>
    r.all_day
      ? dayTime(addDays(localDateKey(start, r.timezone), 1), 0, r.timezone)
      : new Date(
          start.getTime() +
            (r.kind === "event" ? EVENT_MINUTES : TASK_MINUTES) * 60_000,
        );
  const describe = (c: OccurrenceChanges = {}) => {
    const lines: string[] = [];
    const title =
      r.kind === "task" && r.status === "done"
        ? `✓ ${c.title ?? r.title}`
        : (c.title ?? r.title);
    lines.push(`SUMMARY:${text(title)}`);
    const meeting = c.meeting_url ?? r.meeting_url;
    const description = [c.notes ?? r.notes, meeting]
      .filter(Boolean)
      .join("\n\n");
    if (description) lines.push(`DESCRIPTION:${text(description)}`);
    const location = c.location ?? r.location;
    if (location) lines.push(`LOCATION:${text(location)}`);
    if (meeting) lines.push(`URL:${text(meeting)}`);
    const busy = r.kind === "event" && !r.all_day && (c.busy ?? r.busy);
    lines.push(`TRANSP:${busy ? "OPAQUE" : "TRANSPARENT"}`);
    if (o.cancelled) lines.push("STATUS:CANCELLED");
    if (o.organizer && o.attendees?.length) {
      lines.push(
        `ORGANIZER;CN=${param(o.organizer.name)}:mailto:${o.organizer.email}`,
      );
      for (const a of o.attendees)
        lines.push(
          `ATTENDEE;CN=${param(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=${
            PARTSTAT[a.status ?? "needs_action"]
          };RSVP=TRUE:mailto:${a.email}`,
        );
    }
    if (o.alarms)
      for (const minutes of c.alerts ?? r.alerts.map(Number))
        lines.push(
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${text(title)}`,
          `TRIGGER:-PT${minutes}M`,
          "END:VALARM",
        );
    return lines;
  };
  const head = [
    "BEGIN:VEVENT",
    `UID:${r.id}@orbyn`,
    `DTSTAMP:${utc(r.updated_at)}`,
    `SEQUENCE:${r.version}`,
  ];

  const start = r.rrule ? (r.series_start ?? r.due_at) : r.due_at;
  const end = r.rrule ? occurrenceEnd(r, start) : r.end_at;
  out.push(
    ...head,
    timeProp("DTSTART", start, r),
    timeProp("DTEND", end ?? fallbackEnd(start), r),
  );
  if (r.rrule) {
    out.push(`RRULE:${ruleFor(r)}`);
    if (r.exdates.length)
      out.push(
        r.all_day
          ? `EXDATE;VALUE=DATE:${r.exdates.map((d) => dateOnly(new Date(d), r.timezone)).join(",")}`
          : `EXDATE;TZID=${r.timezone}:${r.exdates.map((d) => local(new Date(d), r.timezone)).join(",")}`,
      );
  }
  out.push(...describe(), "END:VEVENT");

  if (r.rrule && !o.cancelled)
    for (const [key, c] of o.overrides ?? []) {
      const occurrence = new Date(key);
      const from = c.due_at ? new Date(c.due_at) : occurrence;
      const until = c.due_at
        ? c.end_at
          ? new Date(c.end_at)
          : null
        : occurrenceEnd(r, occurrence);
      out.push(
        ...head,
        timeProp("RECURRENCE-ID", occurrence, r),
        timeProp("DTSTART", from, r),
        timeProp("DTEND", until ?? fallbackEnd(from), r),
        ...describe(c),
        "END:VEVENT",
      );
    }
  return out;
}

const calendar = (method: string, name: string | null, body: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbyn//Planner//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    ...(name
      ? [`X-WR-CALNAME:${text(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT1H"]
      : []),
    ...body,
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n") + "\r\n";

/**
 * An invitation (METHOD:REQUEST) or its cancellation (METHOD:CANCEL). The
 * UID is the item's, so calendars update the same event, and SEQUENCE is its
 * version, so newer invitations win.
 */
export function inviteCalendar(
  method: "REQUEST" | "CANCEL",
  item: FeedItem,
  organizer: CalendarPerson,
  attendees: CalendarPerson[],
  overrides?: Map<number, OccurrenceChanges>,
) {
  return calendar(
    method,
    null,
    eventLines(item, {
      organizer,
      attendees,
      cancelled: method === "CANCEL",
      overrides: method === "CANCEL" ? undefined : overrides,
    }),
  );
}

export type FeedOptions = {
  /** Only when you're busy, as "Busy", with nothing else. */
  busyOnly?: boolean;
  /** Add your time blocks as "Focus: {task}". */
  includeBlocks?: boolean;
  /** The organizer shown on events with invitees. */
  organizer?: CalendarPerson;
};

const DAY = 86_400_000;

export async function icsFeed(
  db: Db,
  userId: string,
  name: string,
  options: FeedOptions = {},
) {
  const now = Date.now();
  if (options.busyOnly) {
    // The same intervals teammates see: nothing but when.
    const busy = await busyIntervals(
      db,
      userId,
      new Date(now - 30 * DAY),
      new Date(now + 180 * DAY),
      { blocks: true, derived: true, frames: true },
    );
    const stamp = utc(new Date(now));
    return calendar(
      "PUBLISH",
      `Orbyn · ${name} (busy)`,
      busy.flatMap((b) => [
        "BEGIN:VEVENT",
        `UID:busy-${createHash("sha256").update(`${userId}${b.start_at}${b.end_at}`).digest("hex").slice(0, 32)}@orbyn`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(new Date(b.start_at))}`,
        `DTEND:${utc(new Date(b.end_at))}`,
        "SUMMARY:Busy",
        "TRANSP:OPAQUE",
        "CLASS:PRIVATE",
        "END:VEVENT",
      ]),
    );
  }

  const rows = (
    await db.query<FeedItem>(
      `SELECT ${FEED_COLUMNS} FROM items i
       WHERE ${VISIBLE_ITEMS} AND i.due_at IS NOT NULL
         AND (i.rrule IS NOT NULL OR i.due_at > now() - interval '60 days')
       ORDER BY i.due_at LIMIT 2000`,
      [userId],
    )
  ).rows;
  const ids = rows.map((r) => r.id);
  const overrides = await loadOverrides(
    db,
    rows.filter((r) => r.rrule).map((r) => r.id),
  );
  const people = new Map<string, CalendarPerson[]>();
  if (ids.length)
    for (const a of (
      await db.query<CalendarPerson & { item_id: string }>(
        `SELECT item_id, email, name, status FROM item_attendees
         WHERE item_id = ANY ($1::uuid[]) ORDER BY created_at, email`,
        [ids],
      )
    ).rows)
      people.set(a.item_id, [...(people.get(a.item_id) ?? []), a]);
  const body = rows.flatMap((r) =>
    eventLines(r, {
      alarms: true,
      overrides: overrides.get(r.id),
      organizer: options.organizer,
      attendees: people.get(r.id),
    }),
  );
  if (options.includeBlocks) {
    const stamp = utc(new Date(now));
    for (const b of await timeBlocks(
      db,
      userId,
      new Date(now - 60 * DAY),
      new Date(now + 180 * DAY),
    ))
      body.push(
        "BEGIN:VEVENT",
        `UID:block-${b.id}@orbyn`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${utc(new Date(b.start_at))}`,
        `DTEND:${utc(new Date(b.end_at))}`,
        `SUMMARY:${text(`Focus: ${b.title}`)}`,
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
  }
  return calendar("PUBLISH", `Orbyn · ${name}`, body);
}
