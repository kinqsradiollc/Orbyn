import { dayTime, zonedInstant } from "@orbyn/core";

// A small iCalendar (RFC 5545) reader: enough of VEVENT to accept events that
// Apple Calendar, Thunderbird and friends PUT back to us — summary, times,
// location, notes and a repeat rule. Anything it doesn't understand is
// ignored rather than guessed at.

export type ParsedEvent = {
  uid: string;
  title: string;
  notes: string;
  location: string;
  all_day: boolean;
  due_at: string; // ISO instant
  end_at: string | null;
  rrule: string | null;
  timezone: string;
};

/** Unfold folded lines (a CRLF followed by a space or tab continues one). */
function unfold(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && lines.length)
      lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

type Prop = { name: string; params: Record<string, string>; value: string };

function parseLine(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const bits = head.split(";");
  const name = bits[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const b of bits.slice(1)) {
    const eq = b.indexOf("=");
    if (eq > 0)
      params[b.slice(0, eq).toUpperCase()] = b
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** Undo the TEXT escaping the format uses for commas, semicolons and newlines. */
const unescapeText = (v: string) =>
  v.replace(/\\([\\,;nN])/g, (_m, c) => (c === "n" || c === "N" ? "\n" : c));

const isValidZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Split "20260401T090000" (or "20260401") into its numbers. */
function digits(v: string) {
  return {
    y: +v.slice(0, 4),
    mo: +v.slice(4, 6),
    d: +v.slice(6, 8),
    h: +v.slice(9, 11) || 0,
    mi: +v.slice(11, 13) || 0,
  };
}

/** A DTSTART/DTEND value → an absolute instant, given a fallback zone. */
function toInstant(
  prop: Prop,
  fallbackZone: string,
): { at: Date; allDay: boolean; zone: string } {
  const v = prop.value.trim();
  const dateOnly = prop.params.VALUE === "DATE" || /^\d{8}$/.test(v);
  const g = digits(v);
  const key = `${String(g.y).padStart(4, "0")}-${String(g.mo).padStart(2, "0")}-${String(g.d).padStart(2, "0")}`;
  if (dateOnly)
    return {
      at: dayTime(key, 0, fallbackZone),
      allDay: true,
      zone: fallbackZone,
    };
  if (/Z$/.test(v))
    return {
      at: new Date(Date.UTC(g.y, g.mo - 1, g.d, g.h, g.mi)),
      allDay: false,
      zone: fallbackZone,
    };
  const tzid = prop.params.TZID;
  const zone = tzid && isValidZone(tzid) ? tzid : fallbackZone;
  return {
    at: zonedInstant(g.y, g.mo, g.d, g.h, g.mi, zone),
    allDay: false,
    zone,
  };
}

/**
 * The first VEVENT in an iCalendar object, as fields for the item write path.
 * Returns null when there's no usable event (no VEVENT, or no start).
 */
export function parseICalendar(
  body: string,
  fallbackZone: string,
): ParsedEvent | null {
  const props: Prop[] = [];
  let inEvent = false;
  for (const line of unfold(body)) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT")
      inEvent = true;
    else if (p.name === "END" && p.value.toUpperCase() === "VEVENT") break;
    else if (inEvent) props.push(p);
  }
  if (!props.length) return null;
  const get = (n: string) => props.find((p) => p.name === n);

  const dtstart = get("DTSTART");
  if (!dtstart) return null;
  const start = toInstant(dtstart, fallbackZone);

  const dtend = get("DTEND");
  let end: string | null = null;
  if (dtend) end = toInstant(dtend, start.zone).at.toISOString();

  const rrule = get("RRULE")?.value.trim().toUpperCase() || null;

  return {
    uid: (get("UID")?.value || "").trim(),
    title: unescapeText(get("SUMMARY")?.value ?? "").trim() || "(no title)",
    notes: unescapeText(get("DESCRIPTION")?.value ?? ""),
    location: unescapeText(get("LOCATION")?.value ?? "").slice(0, 300),
    all_day: start.allDay,
    due_at: start.at.toISOString(),
    end_at: end,
    rrule,
    timezone: start.zone,
  };
}
