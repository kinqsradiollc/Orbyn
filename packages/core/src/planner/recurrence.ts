import { addDays, formatRrule, weekdayOf, type Frequency } from "./time.js";

/**
 * Repeats written in plain words, found inside a quick-add line:
 *
 *   every day, daily, every weekday, every other week, every 3 months
 *   every Monday, every Mon and Thu, every other Friday, on Tuesdays
 *   the first Tuesday of every month, the last day of the month, the 15th of each month
 *   3 times a week, twice a day, 20 minutes a day      (only a habit can say these)
 *   for 6 weeks, 10 times, until December, until 20 Dec, starting Monday
 *   mornings, in the evenings                          (a habit's window)
 *
 * Deterministic and English-only, like the rest of quick add. What it finds
 * is taken out of the text; quick add decides from the rest whether it makes
 * a repeating item or a habit.
 */
export type RepeatSpan = { start: number; end: number; text: string };

export type RepeatFound = {
  /** Where the phrase was, first to last, in the text given. */
  spans: RepeatSpan[];
  freq: Frequency;
  interval: number;
  /** Weekdays, 0 = Sunday. */
  byDay: number[];
  byMonthDay: number[];
  bySetPos: number[];
  count: number | null;
  /** The last day it may happen, inclusive ("YYYY-MM-DD"). */
  until: string | null;
  /** "for 6 weeks": resolved once the first day is known. */
  lasts: { n: number; unit: "day" | "week" | "month" | "year" } | null;
  /** "3 times a week": sessions per period, which only a habit can hold. */
  perPeriod: { cadence: number; period: "day" | "week" } | null;
  /** "20 minutes a day": the length said inside the phrase. */
  minutes: number | null;
  /** "mornings": a time-of-day window, "HH:MM". */
  window: { start: string; end: string } | null;
};

const START = "(?<=^|\\s)";
const END = "(?=$|[\\s,.;!?])";
const WEEKDAY =
  "mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
const DAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_KEYS = [
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
const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  once: 1,
  two: 2,
  twice: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
  "second last": -2,
  "second-last": -2,
};
const ORD =
  "first|1st|second[ -]last|second|2nd|third|3rd|fourth|4th|fifth|5th|last";
/** One weekday, maybe plural ("mondays"), and nothing glued after it. */
const ONE_DAY = `(?:${WEEKDAY})s?(?=$|[\\s,.;!?&+/])`;
const DAY_LIST = `${ONE_DAY}(?:\\s*(?:,|and|&|\\+|\\/)\\s*(?:and\\s+)?${ONE_DAY})*`;
const WINDOWS: Record<string, { start: string; end: string }> = {
  morning: { start: "06:00", end: "12:00" },
  afternoon: { start: "12:00", end: "17:00" },
  evening: { start: "17:00", end: "22:00" },
  night: { start: "19:00", end: "23:00" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const countOf = (word: string) =>
  /^\d+$/.test(word) ? Number(word) : (COUNT_WORDS[word.toLowerCase()] ?? 0);
const daysIn = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthIndex = (name: string) =>
  MONTH_KEYS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** Every weekday named in "mon, wed and fridays". */
function daysNamed(text: string) {
  const found = text.toLowerCase().match(new RegExp(WEEKDAY, "g")) ?? [];
  return [...new Set(found.map((d) => DAY_INDEX[d.slice(0, 3)]))].sort(
    (a, b) => a - b,
  );
}

/** A day key `months` months after `key`, clamped to the month's length. */
export function addMonthsToDay(key: string, months: number) {
  const [y, m, d] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysIn(year, month)))}`;
}

/**
 * Find a repeat in `text`. `today` is the local day ("YYYY-MM-DD") that
 * "until December" is counted from. Returns null when there is none.
 */
export function findRepeat(text: string, today: string): RepeatFound | null {
  let work = text;
  const spans: RepeatSpan[] = [];
  const found: Omit<RepeatFound, "spans"> = {
    freq: "DAILY",
    interval: 1,
    byDay: [],
    byMonthDay: [],
    bySetPos: [],
    count: null,
    until: null,
    lasts: null,
    perPeriod: null,
    minutes: null,
    window: null,
  };
  let repeats = false;

  /** The first match of `pattern` still in the text; taken out if `use` agrees. */
  const first = (
    pattern: string,
    use: (m: RegExpExecArray) => boolean | void,
  ) => {
    const m = new RegExp(`${START}(?:${pattern})${END}`, "i").exec(work);
    if (!m || use(m) === false) return false;
    const end = m.index + m[0].length;
    spans.push({ start: m.index, end, text: m[0] });
    work = work.slice(0, m.index) + " ".repeat(m[0].length) + work.slice(end);
    return true;
  };
  const interval = (other?: string, n?: string) =>
    other ? 2 : n ? Math.max(1, Math.min(99, Number(n))) : 1;
  const unitFreq = (unit: string): Frequency =>
    unit.startsWith("d")
      ? "DAILY"
      : unit.startsWith("w")
        ? "WEEKLY"
        : unit.startsWith("m")
          ? "MONTHLY"
          : "YEARLY";

  const set = (freq: Frequency, every = 1, byDay: number[] = []) => {
    found.freq = freq;
    found.interval = every;
    found.byDay = byDay;
  };

  // ---- how often ---------------------------------------------------------------
  const phrases: [string, (m: RegExpExecArray) => boolean | void][] = [
    // "3 times a week", "twice a day", "3x per week": only a habit says this.
    [
      "(\\d{1,2}\\s*(?:x|×|times?)|once|twice|(?:one|two|three|four|five|six|seven)\\s+times?)\\s*(?:a|per|each|every|\\/)\\s*(day|week|wk)",
      (m) => {
        const cadence = countOf(m[1].match(/^(?:\d+|[a-z]+)/i)?.[0] ?? "");
        if (!cadence) return false;
        const period = m[2].toLowerCase().startsWith("d") ? "day" : "week";
        found.perPeriod = { cadence, period };
        found.freq = period === "day" ? "DAILY" : "WEEKLY";
      },
    ],
    // "20 minutes a day", "2 hours a week"
    [
      "(\\d+(?:[.,]\\d+)?)\\s*(h|hrs?|hours?|m|mins?|minutes?)\\s+(?:a|per|each|every)\\s+(day|week)",
      (m) => {
        const n = Number(m[1].replace(",", "."));
        const minutes = Math.round(
          m[2].toLowerCase().startsWith("h") ? n * 60 : n,
        );
        if (!minutes) return false;
        found.minutes = minutes;
        const period = m[3].toLowerCase().startsWith("d") ? "day" : "week";
        found.perPeriod = { cadence: 1, period };
        found.freq = period === "day" ? "DAILY" : "WEEKLY";
      },
    ],
    // "the first Tuesday of every month", "last weekday of the month",
    // "every month on the 2nd Friday"
    [
      `(?:(?:on\\s+)?(?:the\\s+)?(${ORD})\\s+(${WEEKDAY}|weekday|day)\\s+of\\s+(?:every|each|the)\\s+month|(?:every|each)\\s+month\\s+on\\s+the\\s+(${ORD})\\s+(${WEEKDAY}|weekday|day))`,
      (m) => {
        const pos = ORDINALS[(m[1] ?? m[3]).toLowerCase().replace("-", " ")];
        const what = (m[2] ?? m[4]).toLowerCase();
        found.freq = "MONTHLY";
        if (what === "day") found.byMonthDay = [pos];
        else {
          found.byDay = what === "weekday" ? [1, 2, 3, 4, 5] : daysNamed(what);
          found.bySetPos = [pos];
        }
      },
    ],
    // "the 15th of every month", "every month on the 15th"
    [
      "(?:(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+of\\s+(?:every|each|the)\\s+month|(?:every|each)\\s+month\\s+on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?)",
      (m) => {
        const day = Number(m[1] ?? m[2]);
        if (day < 1 || day > 31) return false;
        found.freq = "MONTHLY";
        found.byMonthDay = [day];
      },
    ],
    // "every Monday", "every other Fri", "each Mon, Wed and Fri"
    [
      `(?:every|each)\\s+(?:(other)\\s+|(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${DAY_LIST})`,
      (m) => {
        found.freq = "WEEKLY";
        found.interval = interval(m[1], m[2]);
        found.byDay = daysNamed(m[3]);
      },
    ],
    // "every weekday", "every weekend", "every other week", "every 3 months"
    [
      "(?:every|each)\\s+(?:(other)\\s+|(\\d{1,2})\\s+)?(weekdays?|workdays?|weekends?|days?|weeks?|months?|years?|mornings?|afternoons?|evenings?|nights?)",
      (m) => {
        const unit = m[3].toLowerCase();
        // "every 3 day" reads wrong but "every 3 days" doesn't.
        found.interval = interval(m[1], m[2]);
        if (/^(week|work)day/.test(unit)) {
          found.freq = "WEEKLY";
          found.byDay = [1, 2, 3, 4, 5];
        } else if (unit.startsWith("weekend")) {
          found.freq = "WEEKLY";
          found.byDay = [0, 6];
        } else if (/^(morning|afternoon|evening|night)/.test(unit)) {
          found.freq = "DAILY";
          found.window = WINDOWS[unit.replace(/s$/, "")];
        } else found.freq = unitFreq(unit);
      },
    ],
    // "on Tuesdays", "mondays and thursdays": plural means every one.
    [
      `(?:on\\s+)?((?:${WEEKDAY})s(?=$|[\\s,.;!?&+/])(?:\\s*(?:,|and|&|\\+|\\/)\\s*(?:and\\s+)?${ONE_DAY})*)`,
      (m) => {
        found.freq = "WEEKLY";
        found.byDay = daysNamed(m[1]);
      },
    ],
    ["(?:on\\s+)?weekdays", () => set("WEEKLY", 1, [1, 2, 3, 4, 5])],
    ["(?:on\\s+)?weekends", () => set("WEEKLY", 1, [0, 6])],
    ["daily|nightly|everyday", () => set("DAILY")],
    ["weekly", () => set("WEEKLY")],
    ["bi-?weekly|fortnightly|every\\s+fortnight", () => set("WEEKLY", 2)],
    ["monthly", () => set("MONTHLY")],
    ["yearly|annually", () => set("YEARLY")],
  ];
  for (const [pattern, use] of phrases) {
    if (first(pattern, use)) {
      repeats = true;
      break;
    }
  }
  if (!repeats) return null;

  // ---- how long, and the rest that only makes sense with a repeat -------------
  first(
    "for\\s+(?:the\\s+next\\s+)?(\\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(days?|weeks?|months?|years?)",
    (m) => {
      const n = countOf(m[1]);
      if (!n) return false;
      const unit = m[2].toLowerCase().replace(/s$/, "");
      found.lasts = {
        n,
        unit: unit as NonNullable<RepeatFound["lasts"]>["unit"],
      };
    },
  );
  first("(?:for\\s+)?(\\d{1,3})\\s+times(?!\\s+(?:a|per|each)\\s)", (m) => {
    const n = Number(m[1]);
    if (!n || found.perPeriod) return false;
    found.count = n;
  });
  const y = Number(today.slice(0, 4));
  // "until the end of December", "until December": a bare month is up to
  // the month, the end of it is through it.
  first(
    `until\\s+(?:the\\s+)?(end\\s+of\\s+)?(${MONTHS})(?:\\s+(\\d{4}))?`,
    (m) => {
      const mo = monthIndex(m[2]);
      let year = m[3] ? Number(m[3]) : y;
      if (!m[3] && `${year}-${pad(mo)}-${pad(daysIn(year, mo))}` < today)
        year++;
      found.until = m[1]
        ? `${year}-${pad(mo)}-${pad(daysIn(year, mo))}`
        : addDays(`${year}-${pad(mo)}-01`, -1);
      if (found.until < today) return false;
    },
  );
  const upTo = (key: string | null) => {
    if (!key || key < today) return false;
    found.until = key;
  };
  const dated = (mo: number, d: number, yr?: string) => {
    let year = yr ? Number(yr.length === 2 ? `20${yr}` : yr) : y;
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(year, mo)) return null;
    let key = `${year}-${pad(mo)}-${pad(d)}`;
    if (!yr && key < today) key = `${++year}-${pad(mo)}-${pad(d)}`;
    return key;
  };
  if (!found.until)
    first(
      `until\\s+(?:(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2}|\\d{4}))?|(${MONTHS})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?|(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS})\\.?(?:,?\\s+(\\d{4}))?)`,
      (m) =>
        upTo(
          m[1]
            ? dated(+m[2], +m[3], m[1])
            : m[4]
              ? dated(+m[5], +m[4], m[6])
              : m[7]
                ? dated(monthIndex(m[7]), +m[8], m[9])
                : dated(monthIndex(m[11]), +m[10], m[12]),
        ),
    );
  // "starting Monday": the word goes, the date stays for quick add to read.
  first("(?:starting|beginning|from)(?=\\s+(?:on\\s+)?\\S)", () => {});
  if (!found.window)
    first(
      "(?:in\\s+the\\s+)?(mornings|afternoons|evenings|nights)",
      (m) =>
        void (found.window = WINDOWS[m[1].toLowerCase().replace(/s$/, "")]),
    );

  return { spans: spans.sort((a, b) => a.start - b.start), ...found };
}

/** Whether a day matches a monthly rule's day of the month or set position. */
function monthlyMatch(key: string, found: RepeatFound) {
  const [y, m, d] = key.split("-").map(Number);
  const len = daysIn(y, m);
  if (found.byMonthDay.length)
    return found.byMonthDay.some((n) => (n > 0 ? n : len + n + 1) === d);
  if (!found.byDay.includes(weekdayOf(key))) return false;
  if (!found.bySetPos.length) return true;
  const matching: number[] = [];
  for (let day = 1; day <= len; day++)
    if (found.byDay.includes(weekdayOf(`${y}-${pad(m)}-${pad(day)}`)))
      matching.push(day);
  return found.bySetPos.some(
    (p) => matching[p > 0 ? p - 1 : matching.length + p] === d,
  );
}

/**
 * The first day on or after `from` the repeat happens. `skipFrom` is left out
 * (a time today that has already gone). Null when none within two years.
 */
export function firstRepeatDay(
  found: RepeatFound,
  from: string,
  skipFrom = false,
) {
  for (let i = skipFrom ? 1 : 0; i < 800; i++) {
    const key = addDays(from, i);
    const ok =
      found.freq === "MONTHLY"
        ? found.byMonthDay.length || found.byDay.length
          ? monthlyMatch(key, found)
          : true
        : found.freq === "WEEKLY" && found.byDay.length
          ? found.byDay.includes(weekdayOf(key))
          : true;
    if (ok) return key;
  }
  return null;
}

/** The RRULE text for a repeat that starts on `first`. */
export function repeatRrule(found: RepeatFound, first: string) {
  let until = found.until;
  if (found.lasts) {
    const { n, unit } = found.lasts;
    until =
      unit === "day"
        ? addDays(first, n - 1)
        : unit === "week"
          ? addDays(first, n * 7 - 1)
          : addDays(addMonthsToDay(first, unit === "month" ? n : n * 12), -1);
  }
  if (until && until < first) until = null;
  return formatRrule({
    freq: found.freq,
    interval: found.interval,
    byDay: found.byDay,
    byMonthDay: found.byMonthDay,
    bySetPos: found.bySetPos,
    count: found.count,
    until,
  });
}
