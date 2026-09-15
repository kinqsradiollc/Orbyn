import { zonedParts } from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { VISIBLE_ITEMS } from "../../lib/teams.js";

/**
 * An iCalendar (RFC 5545) feed of someone's dated items, for other calendar
 * apps to subscribe to. Read-only: the data stays on this server, and apps
 * fetch the feed with a private link.
 */
type Row = {
  id: string;
  title: string;
  notes: string;
  kind: string;
  status: string;
  due_at: Date;
  end_at: Date | null;
  location: string;
  meeting_url: string;
  rrule: string | null;
  timezone: string;
  series_start: Date | null;
  exdates: Date[];
  updated_at: Date;
};

const text = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");

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

export async function icsFeed(db: Db, userId: string, name: string) {
  const rows = (
    await db.query<Row>(
      `SELECT i.id, i.title, i.notes, i.kind, i.status, i.due_at, i.end_at, i.location,
              i.meeting_url, i.rrule, i.timezone, i.series_start, i.exdates, i.updated_at
       FROM items i
       WHERE ${VISIBLE_ITEMS} AND i.due_at IS NOT NULL
         AND (i.rrule IS NOT NULL OR i.due_at > now() - interval '60 days')
       ORDER BY i.due_at LIMIT 2000`,
      [userId],
    )
  ).rows;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbyn//Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(`Orbyn · ${name}`)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  for (const r of rows) {
    const minutes = r.kind === "event" ? EVENT_MINUTES : TASK_MINUTES;
    const length = r.end_at
      ? r.end_at.getTime() - r.due_at.getTime()
      : minutes * 60_000;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@orbyn`,
      `DTSTAMP:${utc(r.updated_at)}`,
    );
    if (r.rrule) {
      const start = r.series_start ?? r.due_at;
      const end = new Date(start.getTime() + length);
      lines.push(
        `DTSTART;TZID=${r.timezone}:${local(start, r.timezone)}`,
        `DTEND;TZID=${r.timezone}:${local(end, r.timezone)}`,
        `RRULE:${r.rrule}`,
      );
      if (r.exdates.length)
        lines.push(
          `EXDATE;TZID=${r.timezone}:${r.exdates.map((d) => local(new Date(d), r.timezone)).join(",")}`,
        );
    } else
      lines.push(
        `DTSTART:${utc(r.due_at)}`,
        `DTEND:${utc(new Date(r.due_at.getTime() + length))}`,
      );
    const title =
      r.kind === "task" && r.status === "done" ? `✓ ${r.title}` : r.title;
    lines.push(`SUMMARY:${text(title)}`);
    const description = [r.notes, r.meeting_url].filter(Boolean).join("\n\n");
    if (description) lines.push(`DESCRIPTION:${text(description)}`);
    if (r.location) lines.push(`LOCATION:${text(r.location)}`);
    if (r.meeting_url) lines.push(`URL:${text(r.meeting_url)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
