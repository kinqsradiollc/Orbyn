import { isTimeZone, isValidRrule, zonedInstant } from "@orbyn/core";

/**
 * A small, forgiving iCalendar (RFC 5545) reader for calendars people
 * subscribe to by link. It reads VEVENTs only: folded lines, quoted
 * parameters, TZID times (IANA names, a few Windows names, anything else in
 * the fallback zone), whole-day dates, DTEND or DURATION, RRULEs within
 * Orbyn's subset (other rules keep only the first occurrence), EXDATEs,
 * RECURRENCE-ID changes to one occurrence, cancelled events and free
 * (transparent) time. Anything it can't read is skipped, never fatal.
 */
export type IcsEvent = {
  uid: string;
  /** Set when this is one occurrence of a series, changed on its own. */
  recurrence_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  rrule: string | null;
  exdates: string[];
  /** The zone its rule repeats in. */
  timezone: string;
  transparent: boolean;
};

type Prop = { name: string; params: Record<string, string>; value: string };

/** Common Windows zone names (Outlook, Exchange) and their IANA zones. */
const WINDOWS_ZONES: Record<string, string> = {
  "AUS Eastern Standard Time": "Australia/Sydney",
  "E. Australia Standard Time": "Australia/Brisbane",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "W. Australia Standard Time": "Australia/Perth",
  "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central Europe Standard Time": "Europe/Budapest",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Singapore Standard Time": "Asia/Singapore",
  "Coordinated Universal Time": "UTC",
};

function zoneFor(tzid: string | undefined, fallback: string) {
  if (!tzid) return fallback;
  const name = tzid.trim();
  if (isTimeZone(name)) return name;
  // "/mozilla.org/20050126_1/Europe/London" and similar prefixes.
  const tail = name.split("/").slice(-2).join("/");
  if (tail.includes("/") && isTimeZone(tail)) return tail;
  return WINDOWS_ZONES[name] ?? fallback;
}

/** Split "NAME;PARAM=a;X="b:c":value", respecting quotes. */
function parseLine(line: string): Prop | null {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ";") {
      parts.push(current);
      current = "";
      continue;
    } else if (!quoted && ch === ":") {
      parts.push(current);
      const [name, ...rest] = parts;
      const params: Record<string, string> = {};
      for (const p of rest) {
        const eq = p.indexOf("=");
        if (eq > 0)
          params[p.slice(0, eq).toUpperCase()] = p
            .slice(eq + 1)
            .replace(/^"|"$/g, "");
      }
      return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
    }
    current += ch;
  }
  return null;
}

const unescape = (value: string) =>
  value.replace(/\\([nN\\;,])/g, (_, c: string) =>
    c === "n" || c === "N" ? "\n" : c,
  );

type Parsed = { at: Date; date: boolean; zone: string };

function parseDate(p: Prop, fallback: string): Parsed | null {
  const m = p.value
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (p.params.VALUE === "DATE" || !m[4])
    return {
      at: zonedInstant(y, mo, d, 0, 0, fallback),
      date: true,
      zone: fallback,
    };
  const [h, mi, s] = [+m[4], +m[5], +(m[6] ?? 0)];
  if (m[7])
    return {
      at: new Date(Date.UTC(y, mo - 1, d, h, mi, s)),
      date: false,
      zone: "UTC",
    };
  const zone = zoneFor(p.params.TZID, fallback);
  const at = zonedInstant(y, mo, d, h, mi, zone);
  return { at: new Date(at.getTime() + s * 1000), date: false, zone };
}

/** "PT1H30M", "P1D", "-PT15M" in milliseconds. */
function parseDuration(value: string): number | null {
  const m = value
    .trim()
    .match(
      /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i,
    );
  if (!m) return null;
  const ms =
    ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 86_400 +
      +(m[4] ?? 0) * 3600 +
      +(m[5] ?? 0) * 60 +
      +(m[6] ?? 0)) *
    1000;
  return m[1] === "-" ? -ms : ms;
}

/**
 * The rule in Orbyn's subset, or null. WKST is dropped (weeks start on
 * Monday anyway) and a local UNTIL becomes UTC.
 */
function supportedRule(raw: string, zone: string): string | null {
  const parts = raw
    .toUpperCase()
    .split(";")
    .filter((p) => p && !p.startsWith("WKST="))
    .map((p) => {
      const m = p.match(/^UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
      if (!m) return p;
      const at = zonedInstant(+m[1], +m[2], +m[3], +m[4], +m[5], zone);
      return `UNTIL=${at
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "")}`;
    });
  const text = parts.join(";");
  return text.length <= 200 && isValidRrule(text) ? text : null;
}

export function parseIcs(
  text: string,
  fallbackZone: string,
  limit = 5000,
): IcsEvent[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
  const blocks: Prop[][] = [];
  let current: Prop[] | null = null;
  let depth = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    // Alarms and other parts inside an event are skipped.
    if (upper.startsWith("BEGIN:")) {
      depth++;
      continue;
    }
    if (upper.startsWith("END:")) {
      if (depth) depth--;
      else if (upper === "END:VEVENT") {
        blocks.push(current);
        current = null;
        if (blocks.length >= limit * 2) break;
      }
      continue;
    }
    if (depth) continue;
    const prop = parseLine(line);
    if (prop) current.push(prop);
  }

  const events: (IcsEvent & { cancelled: boolean })[] = [];
  for (const props of blocks) {
    const get = (name: string) => props.find((p) => p.name === name);
    const dtstart = get("DTSTART");
    const start = dtstart && parseDate(dtstart, fallbackZone);
    if (!start) continue;
    const dtend = get("DTEND");
    const end = dtend && parseDate(dtend, fallbackZone);
    const duration = get("DURATION");
    const length = duration ? parseDuration(duration.value) : null;
    let endsAt: Date;
    if (end && end.at > start.at) endsAt = end.at;
    else if (length && length > 0)
      endsAt = new Date(start.at.getTime() + length);
    else if (start.date) endsAt = new Date(start.at.getTime() + 86_400_000);
    else endsAt = start.at;
    const rid = get("RECURRENCE-ID");
    const recurrence = rid ? parseDate(rid, fallbackZone) : null;
    const rule = get("RRULE");
    const exdates = props
      .filter((p) => p.name === "EXDATE")
      .flatMap((p) =>
        p.value
          .split(",")
          .map((v) => parseDate({ ...p, value: v }, fallbackZone)),
      )
      .filter((x): x is Parsed => !!x)
      .map((x) => x.at.toISOString());
    const title = unescape(get("SUMMARY")?.value ?? "").trim();
    events.push({
      uid: (
        get("UID")?.value.trim() || `${start.at.toISOString()} ${title}`
      ).slice(0, 500),
      recurrence_id: recurrence ? recurrence.at.toISOString() : null,
      title: title.slice(0, 500),
      starts_at: start.at.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: start.date,
      location: unescape(get("LOCATION")?.value ?? "")
        .trim()
        .slice(0, 300),
      rrule: rule && !recurrence ? supportedRule(rule.value, start.zone) : null,
      exdates,
      timezone: start.zone,
      transparent: get("TRANSP")?.value.trim().toUpperCase() === "TRANSPARENT",
      cancelled: get("STATUS")?.value.trim().toUpperCase() === "CANCELLED",
    });
  }

  // An occurrence changed or cancelled on its own replaces the series' one.
  const series = new Map<string, IcsEvent>();
  for (const e of events)
    if (e.rrule && !e.cancelled && !series.has(e.uid)) series.set(e.uid, e);
  const out: IcsEvent[] = [];
  for (const { cancelled, ...e } of events) {
    if (e.recurrence_id) {
      const master = series.get(e.uid);
      if (master && !master.exdates.includes(e.recurrence_id))
        master.exdates.push(e.recurrence_id);
      if (!cancelled) out.push(e);
    } else if (!cancelled) out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
