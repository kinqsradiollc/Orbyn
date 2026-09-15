import {
  addDays,
  dayTime,
  localDateKey,
  weekdayOf,
  zonedParts,
} from "./time.js";
import type { Item, ItemInput, Kind, Priority } from "./types.js";

/**
 * Quick add: turn one line typed into the command bar into an item, with no
 * AI involved. Deterministic: the same text, zone and clock always give the
 * same result.
 *
 *   ;Cafe Roma        location (up to the next marker)
 *   @anna, @a@b.com   a teammate (assignee on team items) or someone to invite
 *   >Work  #urgent    a list and tags, by name
 *   ! !! !!!          low, medium, high priority (also !low, !high)
 *   tomorrow, fri, next friday, sep 20, 20/9, 2026-09-20, in 3 days (.fri works too)
 *   3pm, 15:30, at 9, noon, 3-4pm, 15:00-16:30
 *   for 2h, 45m       an event's length, or a task's estimate
 *   ~45m              always an estimate
 *   all day
 *
 * A time range, a start with a length, "all day", someone to invite or the
 * word "meeting" makes an event; anything else is a task. A date without a
 * time is a whole day. Hours 1 to 7 without am/pm ("at 3") are afternoon.
 */
export type QuickAddChipKind =
  | "kind"
  | "date"
  | "time"
  | "duration"
  | "estimate"
  | "all_day"
  | "location"
  | "person"
  | "list"
  | "tag"
  | "priority";

/** A recognised part of the text: what was typed and what it means. */
export type QuickAddChip = {
  kind: QuickAddChipKind;
  /** The text as typed. */
  text: string;
  /**
   * What it resolved to: a date ("2026-09-20"), a time ("15:00" or
   * "15:00-16:00"), minutes, a list, tag or user id, an email, a priority,
   * the location, or "event"/"task".
   */
  value: string;
};

export type QuickAddList = { id: string; name: string; team_id: string | null };
export type QuickAddMember = {
  user_id: string;
  name: string;
  email: string;
  /** Teams they share with the person typing. */
  team_ids: string[];
};

export type QuickAddOptions = {
  timeZone: string;
  now?: Date;
  lists?: QuickAddList[];
  tags?: QuickAddList[];
  members?: QuickAddMember[];
  /** The person typing: they can be the assignee but aren't invited. */
  selfId?: string;
};

/** Item fields ready for `POST /items`. */
export type QuickAddDraft = Partial<ItemInput> & { title: string; kind: Kind };

export type QuickAddResult = { input: QuickAddDraft; chips: QuickAddChip[] };

/** What `POST /items/quick` answers once it has created the item. */
export type QuickAddCreated = { item: Item; chips: QuickAddChip[] };

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_INDEX = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const WEEKDAY =
  "mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
/** Where a word starts: the start of the text or after a space. */
const START = "(?<=^|\\s)";
/** Where a word ends. */
const END = "(?=$|[\\s,.;!?])";
/** Words left dangling at either end of a title once the rest is taken out. */
const CONNECTORS = new Set([
  "at",
  "on",
  "by",
  "due",
  "for",
  "with",
  "from",
  "to",
  "and",
  "in",
  "-",
  "–",
  ",",
]);

const pad = (n: number) => String(n).padStart(2, "0");
const clockText = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Minutes after midnight, or null when it isn't a real time. */
function clock(hour: number, minute: number, meridiem?: string): number | null {
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase().startsWith("p");
    return ((hour % 12) + (pm ? 12 : 0)) * 60 + minute;
  }
  if (hour > 23) return null;
  return hour * 60 + minute;
}

function validDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Hours and minutes in "2h", "1.5 hours", "1h30m", "45m", "45 minutes". */
function durationMinutes(
  hours: string | undefined,
  minutes: string | undefined,
) {
  const total =
    Math.round((hours ? Number(hours.replace(",", ".")) : 0) * 60) +
    (minutes ? Number(minutes) : 0);
  return total > 0 && total <= 10080 ? total : null;
}

type Span = { start: number; end: number; text: string };

export function parseQuickAdd(
  text: string,
  options: QuickAddOptions,
): QuickAddResult {
  const tz = options.timeZone;
  const now = options.now ?? new Date();
  const today = localDateKey(now, tz);
  const nowParts = zonedParts(now, tz);
  const nowMinutes = nowParts.hour * 60 + nowParts.minute;
  const source = text.replace(/\s+/g, " ").trim();
  let work = source;
  const chips: (QuickAddChip & { at: number })[] = [];

  /** Take a span out of the text, leaving spaces so positions don't move. */
  const take = (start: number, end: number) => {
    work = work.slice(0, start) + " ".repeat(end - start) + work.slice(end);
  };
  const putBack = (span: Span) => {
    work = work.slice(0, span.start) + span.text + work.slice(span.end);
  };
  const chip = (
    kind: QuickAddChipKind,
    span: { start: number; text: string },
    value: string,
  ) => chips.push({ kind, text: span.text.trim(), value, at: span.start });
  /** Every match of `pattern` in what's left, first to last. */
  const each = (
    pattern: string,
    handle: (m: RegExpExecArray, span: Span) => boolean | void,
  ) => {
    const re = new RegExp(pattern, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(work))) {
      if (!m[0].trim()) {
        re.lastIndex++;
        continue;
      }
      const span = {
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
      };
      if (handle(m, span) !== false) take(span.start, span.end);
    }
  };

  // ---- location: ";" up to the next marker, or a date or time --------------
  let location: string | undefined;
  each(";\\s*([^;@>#!~]*)", (m, span) => {
    let value = m[1];
    // "…;Cafe Roma tomorrow 3pm": the location stops where the time starts.
    const cut = value.search(
      new RegExp(
        `\\s(?:(?:on|at|by|from)\\s+)?(?:\\.?(?:today|tonight|tomorrow|tmrw?|next\\s|this\\s|in\\s\\d|${WEEKDAY}|${MONTHS})${END}|\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)${END}|\\d{1,2}:\\d{2}|\\d{1,2}\\/\\d{1,2}|\\d{4}-\\d{2}|all[ -]day|for\\s+(?:\\d|an?\\s+hour|half)|~|\\.(?=[a-z0-9]))`,
        "i",
      ),
    );
    if (cut >= 0) value = value.slice(0, cut);
    const trimmed = value.trim();
    if (!trimmed) return false;
    location = trimmed.slice(0, 300);
    // A closing ";" ends the location too: ";Cafe Roma; lunch".
    const end =
      cut < 0 && work[span.end] === ";"
        ? span.end + 1
        : span.start + (m[0].length - m[1].length) + value.length;
    const taken = { start: span.start, end, text: work.slice(span.start, end) };
    chip("location", taken, location);
    take(taken.start, taken.end);
    return false;
  });

  // ---- people, lists and tags: taken now, resolved once the team is known ---
  const members = options.members ?? [];
  type Person = { span: Span; member?: QuickAddMember; email?: string };
  const people: Person[] = [];
  each(`${START}@([^\\s@]+@[^\\s@]+\\.[a-z]{2,})${END}`, (m, span) => {
    const email = m[1].toLowerCase();
    people.push({
      span,
      email,
      member: members.find((x) => x.email.toLowerCase() === email),
    });
  });
  /** The longest name in `names` typed right after position `at`. */
  const longest = <T extends { name: string }>(at: number, names: T[]) => {
    const after = work.slice(at).toLowerCase();
    return [...names]
      .filter((n) => n.name.trim())
      .sort((a, b) => b.name.length - a.name.length)
      .find((n) => {
        const name = n.name.toLowerCase();
        return (
          after.startsWith(name) &&
          /^($|[\s,.;!?])/.test(after.slice(name.length))
        );
      });
  };
  each(`${START}@(\\S+)`, (m, span) => {
    const byName = longest(span.start + 1, members);
    let member = byName;
    let end = span.end;
    if (byName) end = span.start + 1 + byName.name.length;
    else {
      const token = loose(m[1]);
      const found = members.filter(
        (x) =>
          loose(x.name) === token ||
          loose(x.name.split(" ")[0] ?? "") === token ||
          loose(x.email.split("@")[0]) === token,
      );
      if (found.length !== 1) return false;
      member = found[0];
      end = span.start + m[0].replace(/[,.;!?]+$/, "").length;
    }
    const taken = { start: span.start, end, text: work.slice(span.start, end) };
    people.push({ span: taken, member });
    take(taken.start, taken.end);
    return false;
  });

  const named = (marker: string, all: QuickAddList[]) => {
    const found: { span: Span; matches: QuickAddList[] }[] = [];
    each(`${START}${marker}(\\S+)`, (m, span) => {
      const exact = longest(span.start + 1, all);
      let end: number;
      let matches: QuickAddList[];
      if (exact) {
        end = span.start + 1 + exact.name.length;
        matches = all.filter(
          (x) => x.name.toLowerCase() === exact.name.toLowerCase(),
        );
      } else {
        const token = loose(m[1]);
        matches = all.filter((x) => loose(x.name) === token);
        if (!matches.length) return false;
        end = span.start + m[0].replace(/[,.;!?]+$/, "").length;
      }
      const taken = {
        start: span.start,
        end,
        text: work.slice(span.start, end),
      };
      found.push({ span: taken, matches });
      take(taken.start, taken.end);
      return false;
    });
    return found;
  };
  const listTokens = named(">", options.lists ?? []);
  const tagTokens = named("#", options.tags ?? []);

  // ---- priority -------------------------------------------------------------
  let priority: Priority | undefined;
  each(`${START}(!{1,3}|!(?:low|med|medium|high|[1-3]))${END}`, (m, span) => {
    const raw = m[1].toLowerCase();
    const level: Priority =
      raw === "!" || raw === "!low" || raw === "!1"
        ? "low"
        : raw === "!!" || raw.startsWith("!med") || raw === "!2"
          ? "medium"
          : "high";
    priority = level;
    chip("priority", span, level);
  });

  // ---- all day, estimates ----------------------------------------------------
  let allDay = false;
  each(`${START}all[ -]day${END}`, (_m, span) => {
    allDay = true;
    chip("all_day", span, "true");
  });
  let estimate: number | undefined;
  const HOURS = "(\\d+(?:[.,]\\d+)?)\\s*(?:h|hrs?|hours?)";
  const MINUTES = "(\\d+)\\s*(?:m|mins?|minutes?)";
  each(
    `${START}~\\s*(?:${HOURS}(?:\\s*${MINUTES.replace("(?:m|", "(?:m?|")})?|${MINUTES})${END}`,
    (m, span) => {
      const minutes = durationMinutes(m[1], m[2] ?? m[3]);
      if (!minutes) return false;
      estimate = minutes;
      chip("estimate", span, String(minutes));
    },
  );

  // ---- dates written with numbers ----------------------------------------------
  let date: string | undefined;
  const setDate = (key: string | null, span: Span) => {
    if (!key || date) return false;
    date = key;
    chip("date", span, key);
  };
  const DATE_PREFIX = "(?:(?:on|by|due)\\s+)?\\.?";
  each(`${START}${DATE_PREFIX}(\\d{4})-(\\d{2})-(\\d{2})${END}`, (m, span) =>
    setDate(validDate(+m[1], +m[2], +m[3]), span),
  );
  each(
    `${START}${DATE_PREFIX}(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?${END}`,
    (m, span) => {
      const [d, mo] = [+m[1], +m[2]];
      let year = m[3]
        ? m[3].length === 2
          ? 2000 + +m[3]
          : +m[3]
        : +today.slice(0, 4);
      let key = validDate(year, mo, d);
      if (key && !m[3] && key < today) key = validDate(++year, mo, d);
      return setDate(key, span);
    },
  );

  // ---- times: ranges, lengths, then single times -------------------------------
  let start: number | undefined;
  let finish: number | undefined;
  let length: number | undefined;
  each(
    `${START}(?:from\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\s*(?:-|–|to|until)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?${END}`,
    (m, span) => {
      if (start !== undefined) return false;
      // Without am, pm or minutes, "2-3" is more likely something else.
      if (!m[3] && !m[6] && !m[2] && !m[5]) return false;
      const endAt = clock(+m[4], +(m[5] ?? 0), m[6]);
      let from = clock(+m[1], +(m[2] ?? 0), m[3] ?? m[6]);
      // "11-1pm" is 11 am to 1 pm.
      if (from !== null && endAt !== null && !m[3] && m[6] && from >= endAt)
        from = clock(
          +m[1],
          +(m[2] ?? 0),
          m[6].toLowerCase() === "pm" ? "am" : "pm",
        );
      if (from === null || endAt === null || endAt <= from) return false;
      start = from;
      finish = endAt;
      chip("time", span, `${clockText(from)}-${clockText(endAt)}`);
    },
  );
  each(
    `${START}(?:for\\s+)?(?:${HOURS}(?:\\s*(\\d{1,2})\\s*(?:m|mins?|minutes?)?)?|${MINUTES}|(an?|half an)\\s+hour)${END}`,
    (m, span) => {
      if (length !== undefined) return false;
      // A bare number with no "for" and no unit never gets here; "an hour"
      // needs the "for".
      if (m[4] && !/^for\s/i.test(span.text.trim())) return false;
      const minutes = m[4]
        ? m[4].toLowerCase() === "half an"
          ? 30
          : 60
        : durationMinutes(m[1], m[2] ?? m[3]);
      if (!minutes) return false;
      length = minutes;
      chip("duration", span, String(minutes));
    },
  );
  const setTime = (minutes: number | null, span: Span) => {
    if (minutes === null || start !== undefined) return false;
    start = minutes;
    chip("time", span, clockText(minutes));
  };
  each(
    `${START}(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)${END}`,
    (m, span) => setTime(clock(+m[1], +(m[2] ?? 0), m[3]), span),
  );
  each(`${START}(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)${END}`, (m, span) =>
    setTime(clock(+m[1], +m[2]), span),
  );
  each(`${START}(?:at\\s+)?(noon|midday|midnight)${END}`, (m, span) =>
    setTime(m[1].toLowerCase() === "midnight" ? 0 : 720, span),
  );
  each(`${START}at\\s+(\\d{1,2})${END}`, (m, span) => {
    const hour = +m[1];
    // "at 3" is 3 pm; "at 9" is 9 am.
    return setTime(clock(hour >= 1 && hour <= 7 ? hour + 12 : hour, 0), span);
  });

  // ---- dates written with words ------------------------------------------------
  const monthOf = (name: string) =>
    MONTH_INDEX.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const monthDay = (mo: number, d: number, y?: string) => {
    let year = y ? +y : +today.slice(0, 4);
    let key = validDate(year, mo, d);
    if (key && !y && key < today) key = validDate(++year, mo, d);
    return key;
  };
  each(
    `${START}${DATE_PREFIX}(${MONTHS})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`,
    (m, span) => setDate(monthDay(monthOf(m[1]), +m[2], m[3]), span),
  );
  each(
    `${START}${DATE_PREFIX}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS})\\.?(?:,?\\s+(\\d{4}))?${END}`,
    (m, span) => setDate(monthDay(monthOf(m[2]), +m[1], m[3]), span),
  );
  let tonight = false;
  each(
    `${START}${DATE_PREFIX}(today|tonight|tomorrow|tmrw?|day after tomorrow)${END}`,
    (m, span) => {
      const word = m[1].toLowerCase();
      if (word === "tonight") tonight = true;
      return setDate(
        addDays(
          today,
          word === "day after tomorrow"
            ? 2
            : word.startsWith("tom") || word.startsWith("tmr")
              ? 1
              : 0,
        ),
        span,
      );
    },
  );
  const mondayIndex = (w: number) => (w + 6) % 7;
  each(
    `${START}${DATE_PREFIX}(?:(next|this)\\s+)?(${WEEKDAY})${END}`,
    (m, span) => {
      const target = WEEKDAYS[m[2].slice(0, 3).toLowerCase()];
      const todayW = weekdayOf(today);
      // "friday" is the coming Friday (today if it's Friday); "next friday"
      // is the Friday of next week.
      const key =
        m[1]?.toLowerCase() === "next"
          ? addDays(today, 7 - mondayIndex(todayW) + mondayIndex(target))
          : addDays(today, (target - todayW + 7) % 7);
      return setDate(key, span);
    },
  );
  each(
    `${START}${DATE_PREFIX}in\\s+(\\d{1,3})\\s+(days?|weeks?)${END}`,
    (m, span) =>
      setDate(
        addDays(today, +m[1] * (m[2].toLowerCase().startsWith("w") ? 7 : 1)),
        span,
      ),
  );
  each(`${START}${DATE_PREFIX}next\\s+week${END}`, (_m, span) =>
    setDate(addDays(today, 7 - mondayIndex(weekdayOf(today))), span),
  );

  // ---- where it belongs: the list decides the team -------------------------------
  const list = listTokens.find((t) => t.matches.length)?.matches[0];
  for (const t of listTokens.slice(1)) putBack(t.span);
  let teamId: string | null = list ? list.team_id : null;
  if (!list && tagTokens.length) {
    // Team tags alone put the item in that team, when they agree on one.
    const personal = tagTokens.some((t) => t.matches.some((x) => !x.team_id));
    const teams = new Set(
      tagTokens.flatMap((t) =>
        t.matches.filter((x) => x.team_id).map((x) => x.team_id!),
      ),
    );
    if (!personal && teams.size === 1) teamId = [...teams][0];
  }
  if (list) chip("list", listTokens[0].span, list.id);
  const tagIds: string[] = [];
  for (const t of tagTokens) {
    const tag = t.matches.find((x) => x.team_id === teamId);
    if (!tag || tagIds.includes(tag.id)) {
      putBack(t.span);
      continue;
    }
    tagIds.push(tag.id);
    chip("tag", t.span, tag.id);
  }
  let assignee: string | undefined;
  const attendees: { email: string; name?: string }[] = [];
  for (const p of people) {
    const m = p.member;
    if (m && teamId && m.team_ids.includes(teamId) && !assignee) {
      assignee = m.user_id;
      chip("person", p.span, m.email);
    } else if (m && m.user_id === options.selfId) putBack(p.span);
    else {
      const email = (m?.email ?? p.email)!.toLowerCase();
      if (attendees.some((a) => a.email === email)) continue;
      attendees.push(m ? { email, name: m.name } : { email });
      chip("person", p.span, email);
    }
  }

  // ---- task or event -------------------------------------------------------------
  const event =
    finish !== undefined ||
    (start !== undefined && length !== undefined) ||
    allDay ||
    attendees.length > 0 ||
    /\bmeet(ing)?\b/i.test(source);
  const kind: Kind = event ? "event" : "task";
  if (!event && length !== undefined && estimate === undefined) {
    estimate = length;
    const c = chips.find((x) => x.kind === "duration");
    if (c) c.kind = "estimate";
    length = undefined;
  }
  if (tonight && start === undefined && !allDay) start = 19 * 60;
  // An event needs a start: the next full hour today when none was given.
  if (event && date === undefined && start === undefined && !allDay)
    start = Math.min(23 * 60, (nowParts.hour + 1) * 60);
  // A time with no date is its next one: today, or tomorrow once it's passed.
  if (start !== undefined && date === undefined)
    date = start > nowMinutes ? today : addDays(today, 1);
  if (allDay && date === undefined) date = today;
  const wholeDay = date !== undefined && (allDay || start === undefined);

  const input: QuickAddDraft = { title: "", kind };
  if (date !== undefined) {
    input.timezone = tz;
    if (wholeDay) {
      input.all_day = true;
      input.due_at = dayTime(date, 0, tz).toISOString();
      if (event) input.end_at = dayTime(addDays(date, 1), 0, tz).toISOString();
    } else {
      const at = dayTime(date, start!, tz);
      input.due_at = at.toISOString();
      if (finish !== undefined)
        input.end_at = dayTime(date, finish, tz).toISOString();
      else if (event && length !== undefined)
        input.end_at = new Date(at.getTime() + length * 60_000).toISOString();
    }
  }
  if (location) input.location = location;
  if (priority) input.priority = priority;
  if (estimate !== undefined && kind === "task")
    input.estimate_minutes = estimate;
  if (list) input.list_id = list.id;
  if (tagIds.length) input.tag_ids = tagIds;
  input.team_id = teamId;
  if (assignee) input.assignee_id = assignee;
  if (attendees.length) input.attendees = attendees;

  // What's left is the title, without words left hanging at either end.
  const words = work.split(" ").filter(Boolean);
  while (words.length && CONNECTORS.has(words[0].toLowerCase())) words.shift();
  while (words.length && CONNECTORS.has(words.at(-1)!.toLowerCase()))
    words.pop();
  input.title = words
    .join(" ")
    .replace(/\s+([,.!?])/g, "$1")
    .slice(0, 200);

  chips.push({ kind: "kind", text: "", value: kind, at: -1 });
  return {
    input,
    chips: chips
      .sort((a, b) => a.at - b.at)
      .map(({ kind: k, text: t, value }) => ({ kind: k, text: t, value })),
  };
}
