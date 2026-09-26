import { z } from "zod";
import { linkMarkdown } from "./links.js";
import { findRepeat, firstRepeatDay, repeatRrule } from "./recurrence.js";
import {
  dayTime,
  isTimeZone,
  isValidRrule,
  localDateKey,
  zonedInstant,
} from "./time.js";

/**
 * Bringing another app's export into Orbyn (DATA-08): Markdown files (a
 * folder of notes, zipped, with [[links]]), a Notion export, and tasks from
 * Todoist and TickTick. Every import shows a dry run first — what would come
 * in, and what would be left out — and only then writes.
 *
 * Everything here is pure: reading the files and deciding what they become.
 * Unzipping and writing happen on the server.
 */

// ------------------------------------------------------------------- CSV

/** A small RFC 4180 CSV reader: quotes, commas and newlines in fields. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** CSV rows keyed by their header, lower-cased; empty rows dropped. */
export function csvRecords(
  table: string[][],
  headerAt = 0,
): Record<string, string>[] {
  const header = table[headerAt];
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return table
    .slice(headerAt + 1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) =>
      Object.fromEntries(keys.map((k, n) => [k, (r[n] ?? "").trim()])),
    );
}

// ----------------------------------------------------------------- tasks

/** A task as another app's export describes it. */
export type ImportedTask = {
  title: string;
  notes: string;
  status: "todo" | "done";
  priority: "low" | "medium" | "high";
  /** ISO time, or null. */
  due_at: string | null;
  /** A whole day: `due_at` is its local midnight in `timezone`. */
  all_day: boolean;
  /** How it repeats, when the export said so in a form Orbyn reads. */
  rrule: string | null;
  /** The zone its day and time were read in. */
  timezone: string;
  /** A date that was there but was not used: unreadable, or a repeat left out. */
  date_dropped: "unread" | "repeat" | null;
  /** The list it goes in (a Todoist section, a TickTick list). */
  list: string | null;
  tags: string[];
};

/** What a date another app wrote becomes. */
export type ImportDate = {
  due_at: string | null;
  all_day: boolean;
  rrule: string | null;
  dropped: "unread" | "repeat" | null;
};

const NO_DATE: ImportDate = {
  due_at: null,
  all_day: false,
  rrule: null,
  dropped: null,
};
const UNREAD: ImportDate = { ...NO_DATE, dropped: "unread" };

const MONTH_NAMES = [
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
const monthOf = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  const n = MONTH_NAMES.indexOf(w.slice(0, 3));
  if (n < 0) return 0;
  // "Sept" and full names are fine; "Octo" or "Marc" are not.
  const full = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ][n];
  return w === full || w.length === 3 || (n === 8 && w === "sept") ? n + 1 : 0;
};

/** "9:30", "17:00", "9am", "5:30 pm" as minutes; a bare "9" is not a time. */
function clockOf(text: string): number | null | undefined {
  const t = text
    .trim()
    .replace(/^(?:at|@|,)\s*/i, "")
    .trim();
  if (!t) return undefined;
  const m =
    /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(t);
  if (!m || (m[2] === undefined && !m[3])) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].toLowerCase().startsWith("p");
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

const realDay = (y: number, m: number, d: number) =>
  y >= 2000 &&
  y <= 2200 &&
  m >= 1 &&
  m <= 12 &&
  d >= 1 &&
  new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** A day, maybe with a time, on the person's wall clock in `timeZone`. */
function onDay(
  y: number,
  m: number,
  d: number,
  minutes: number | undefined,
  timeZone: string,
): ImportDate {
  if (!realDay(y, m, d)) return UNREAD;
  if (minutes === undefined)
    return {
      ...NO_DATE,
      all_day: true,
      due_at: dayTime(key(y, m, d), 0, timeZone).toISOString(),
    };
  return {
    ...NO_DATE,
    due_at: zonedInstant(
      y,
      m,
      d,
      Math.floor(minutes / 60),
      minutes % 60,
      timeZone,
    ).toISOString(),
  };
}

/**
 * A date another app wrote (DATA-08). Only dates that can't be misread are
 * taken: ISO forms ("2026-10-03", "2026-10-03T09:00", with or without an
 * offset) and a month name with a day and a year ("Oct 3 2026", "3 October
 * 2026 9am"). A day and time without an offset is read on the person's own
 * clock in `timeZone`; a bare day is a whole day there. Simple repeats
 * ("every Monday", "every other week at 9am") become a repeat rule starting
 * on their next day. Anything else ("Oct 3", "tomorrow", a date before 2000)
 * is no date, and says why, so the dry run can tell the person rather than
 * guess. English month names only; `lang` other than English takes ISO
 * forms only.
 */
export function readImportDate(
  raw: string,
  timeZone: string,
  opts: { now?: Date; lang?: string } = {},
): ImportDate {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return NO_DATE;
  const zone = isTimeZone(timeZone) ? timeZone : "UTC";
  // An exact instant: an ISO time with its offset.
  const exact =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.exec(
      t,
    );
  if (exact) {
    const [, y, mo, d, hh, mm, ss, off] = exact;
    if (!realDay(+y, +mo, +d) || +hh > 23 || +mm > 59) return UNREAD;
    const offset =
      off.toUpperCase() === "Z"
        ? "Z"
        : off.includes(":")
          ? off
          : `${off.slice(0, 3)}:${off.slice(3)}`;
    const at = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss ?? "00"}${offset}`);
    return isNaN(at.getTime())
      ? UNREAD
      : { ...NO_DATE, due_at: at.toISOString() };
  }
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(
      t,
    );
  if (iso) {
    const [, y, mo, d, hh, mm] = iso;
    if (hh !== undefined && (+hh > 23 || +mm > 59)) return UNREAD;
    return onDay(
      +y,
      +mo,
      +d,
      hh === undefined ? undefined : +hh * 60 + +mm,
      zone,
    );
  }
  const english = !opts.lang || /^en\b/i.test(opts.lang.trim());
  if (!english) return UNREAD;
  // "Oct 3 2026", "October 3, 2026", "Sat 3 Oct 2026", then maybe a time.
  const words = t.replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, "");
  const md =
    /^([a-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b(.*)$/i.exec(words);
  const dm =
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+\.?),?\s+(\d{4})\b(.*)$/i.exec(words);
  const parts = md
    ? { month: md[1], day: md[2], year: md[3], rest: md[4] }
    : dm
      ? { month: dm[2], day: dm[1], year: dm[3], rest: dm[4] }
      : null;
  if (parts) {
    const month = monthOf(parts.month);
    const clock = clockOf(parts.rest);
    if (!month || clock === null) return UNREAD;
    return onDay(+parts.year, month, +parts.day, clock, zone);
  }
  // A repeat said in words.
  if (/\b(every|daily|weekly|monthly|yearly|annually|weekdays)\b/i.test(t)) {
    const today = localDateKey(opts.now ?? new Date(), zone);
    const found = findRepeat(t, today);
    const left = { ...NO_DATE, dropped: "repeat" as const };
    if (!found || found.perPeriod || found.minutes || found.window) return left;
    let rest = t;
    for (const span of [...found.spans].sort((a, b) => b.start - a.start))
      rest = rest.slice(0, span.start) + " " + rest.slice(span.end);
    const clock = clockOf(rest.replace(/[\s,]+/g, " "));
    if (clock === null) return left;
    const first = firstRepeatDay(found, today);
    if (!first) return left;
    const rrule = repeatRrule(found, first);
    if (!isValidRrule(rrule)) return left;
    const [y, m, d] = first.split("-").map(Number);
    return { ...onDay(y, m, d, clock, zone), rrule };
  }
  return UNREAD;
}

/** A date another app wrote, as an ISO time, or null (see readImportDate). */
export function importDate(s: string, timeZone = "UTC"): string | null {
  return readImportDate(s, timeZone).due_at;
}

/** The fields a task takes from a date read by readImportDate. */
const dateFields = (d: ImportDate, timezone: string) => ({
  due_at: d.due_at,
  all_day: d.all_day,
  rrule: d.rrule,
  timezone,
  date_dropped: d.dropped,
});

/** A row's own zone when it names a real one, else the person's. */
const zoneOf = (named: string, fallback: string) =>
  named && isTimeZone(named) ? named : isTimeZone(fallback) ? fallback : "UTC";

/**
 * What the dry run says about dates it left out, in words: "2 dates couldn't
 * be read, so those tasks come in with no date".
 */
export function droppedDateNotes(tasks: ImportedTask[]): string[] {
  const unread = tasks.filter((t) => t.date_dropped === "unread").length;
  const repeats = tasks.filter((t) => t.date_dropped === "repeat").length;
  const notes: string[] = [];
  if (unread)
    notes.push(
      `${unread} date${unread === 1 ? "" : "s"} couldn't be read, so ${unread === 1 ? "that task comes" : "those tasks come"} in with no date.`,
    );
  if (repeats)
    notes.push(
      `${repeats} repeat${repeats === 1 ? "" : "s"} couldn't be kept, so ${repeats === 1 ? "that task comes" : "those tasks come"} in once, without repeating.`,
    );
  return notes;
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (r[k]) return r[k];
  return "";
};

/**
 * Todoist's CSV export: TYPE task/section/note, CONTENT, DESCRIPTION,
 * PRIORITY (1 is the most urgent), DATE. A section names the list the tasks
 * after it go in; a note joins the task before it; an indented task keeps
 * its place as its own task.
 */
export function todoistTasks(
  text: string,
  timeZone = "UTC",
  now?: Date,
): ImportedTask[] {
  const rows = csvRecords(parseCsvTable(text));
  const out: ImportedTask[] = [];
  let section: string | null = null;
  for (const r of rows) {
    const type = pick(r, "type").toLowerCase();
    const content = pick(r, "content", "title", "name");
    if (type === "section") {
      section = content.slice(0, 80) || null;
      continue;
    }
    if (type === "note") {
      const last = out[out.length - 1];
      if (last && content)
        last.notes = [last.notes, content].filter(Boolean).join("\n\n");
      continue;
    }
    if (type && type !== "task") continue;
    if (!content) continue;
    // Labels are written into the task as @label.
    const tags = [...content.matchAll(/(?:^|\s)@([\p{L}\p{N}_-]+)/gu)].map(
      (m) => m[1],
    );
    const title = content
      .replace(/(?:^|\s)@[\p{L}\p{N}_-]+/gu, "")
      .trim()
      .slice(0, 200);
    const p = Number(pick(r, "priority"));
    out.push({
      title: title || content.slice(0, 200),
      notes: pick(r, "description"),
      status: "todo",
      priority:
        p === 1 ? "high" : p === 2 ? "high" : p === 4 ? "low" : "medium",
      // DATE holds what the person typed ("Oct 3", "every monday"), read
      // in the row's TIMEZONE and DATE_LANG.
      ...(() => {
        const zone = zoneOf(pick(r, "timezone"), timeZone);
        return dateFields(
          readImportDate(pick(r, "date", "due date", "deadline"), zone, {
            now,
            lang: pick(r, "date_lang"),
          }),
          zone,
        );
      })(),
      list: section,
      tags,
    });
  }
  return out;
}

/**
 * TickTick writes "2026-10-03T09:00:00+0000" with its "Timezone" and "Is All
 * Day" columns, and a "Repeat" column holding an RRULE.
 */
function tickTickDate(r: Record<string, string>, timeZone: string, now?: Date) {
  const zone = zoneOf(pick(r, "timezone"), timeZone);
  let d = readImportDate(pick(r, "due date", "start date"), zone, { now });
  if (d.due_at && !d.all_day && /^true$/i.test(pick(r, "is all day"))) {
    const [y, m, day] = localDateKey(new Date(d.due_at), zone)
      .split("-")
      .map(Number);
    d = onDay(y, m, day, undefined, zone);
  }
  const repeat = pick(r, "repeat").replace(/^RRULE:/i, "");
  if (repeat && d.due_at) {
    if (isValidRrule(repeat)) d = { ...d, rrule: repeat };
    else d = { ...d, dropped: "repeat" };
  }
  return dateFields(d, zone);
}

/**
 * TickTick's CSV backup: a few lines about the backup, then a table with
 * "List Name", "Title", "Content", "Tags", "Due Date", "Priority" (0 none,
 * 1 low, 3 medium, 5 high) and "Status" (0 open, 1 or 2 done).
 */
export function tickTickTasks(
  text: string,
  timeZone = "UTC",
  now?: Date,
): ImportedTask[] {
  const table = parseCsvTable(text);
  const headerAt = table.findIndex((r) =>
    r.some((c) => c.trim().toLowerCase() === "title"),
  );
  if (headerAt < 0) return [];
  const rows = csvRecords(table, headerAt);
  const out: ImportedTask[] = [];
  for (const r of rows) {
    const title = pick(r, "title");
    if (!title) continue;
    const p = Number(pick(r, "priority"));
    const status = pick(r, "status");
    out.push({
      title: title.slice(0, 200),
      notes: pick(r, "content"),
      status: status === "1" || status === "2" ? "done" : "todo",
      priority: p >= 5 ? "high" : p === 1 ? "low" : "medium",
      ...tickTickDate(r, timeZone, now),
      list: pick(r, "list name") || null,
      tags: pick(r, "tags")
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }
  return out;
}

// ----------------------------------------------------------------- pages

/** A task file's format, as the import's Format choice names it. */
export type TaskImportFormat = "orbyn" | "csv" | "todoist" | "ticktick";

/** Which app a CSV came from, by its header (DATA-08). */
export function csvFormat(text: string): TaskImportFormat {
  const head = text.slice(0, 2000).toLowerCase();
  if (/^\ufeff?"?type"?,"?content"?/.test(head)) return "todoist";
  if (head.includes('"list name"') || head.includes("list name,"))
    return "ticktick";
  return "csv";
}

export const PAGE_IMPORT_FORMATS = ["markdown", "notion"] as const;
export type PageImportFormat = (typeof PAGE_IMPORT_FORMATS)[number];

/** A file from the export: its path inside the zip, and its words. */
export type ImportFile = { path: string; text: string };

export type PlannedPage = {
  /** Its path in the export, to find links to it. */
  path: string;
  title: string;
  /** The folder it goes in (one level: the export's top folders). */
  folder: string;
  /** Its Markdown, links still as the export wrote them. */
  markdown: string;
};

export type PlannedProject = { name: string; tasks: ImportedTask[] };

export type PagesImportPlan = {
  folders: string[];
  pages: PlannedPage[];
  /** Notion databases: each becomes a project, its rows tasks. */
  projects: PlannedProject[];
  /** What was left out, in words ("3 pictures"). */
  left_out: string[];
};

export const PAGE_IMPORT_LIMITS = {
  /** The zip or file as sent, in bytes. */
  maxBytes: 20 * 1024 * 1024,
  maxFiles: 2000,
  /** Pages made by one import. */
  maxPages: 1000,
  /** One page's Markdown. */
  maxPageChars: 500_000,
} as const;

export const pageImportInput = z
  .object({
    format: z.enum(PAGE_IMPORT_FORMATS),
    /** The file's name: .zip, or one .md / .markdown / .txt file. */
    file_name: z.string().trim().min(1).max(200),
    /** The file, base64. */
    data: z
      .string()
      .min(1)
      .max(Math.ceil((PAGE_IMPORT_LIMITS.maxBytes * 4) / 3) + 8),
    /** The team it goes in; your own pages when left out. */
    team_id: z.uuid().nullable().optional(),
    /** Count what would come in, without writing anything. */
    dry_run: z.boolean().default(true),
  })
  .strict();
export type PageImportInput = z.input<typeof pageImportInput>;

export type PagesImportSummary = {
  pages: number;
  folders: number;
  projects: number;
  tasks: number;
  /** Links between the imported pages that now work in Orbyn. */
  links: number;
  sample: string[];
  left_out: string[];
  errors: string[];
  /** After a real import: the first folder made, to open. */
  folder_id?: string | null;
};

/** Notion adds " <32 hex>" to every file and folder name. */
const NOTION_ID = /\s+[0-9a-f]{32}$/i;

const baseName = (path: string) => path.split("/").pop() ?? path;
const stripExt = (name: string) =>
  name.replace(/\.(md|markdown|txt|csv)$/i, "");

export const cleanImportName = (name: string) =>
  stripExt(name).replace(NOTION_ID, "").trim();

/** Remove a leading "--- … ---" block (front matter). */
const withoutFrontMatter = (text: string) =>
  text.replace(/^﻿?---\n[\s\S]*?\n---\n?/, "");

/** A page's title: its first "# " line when it opens with one, else its name. */
function titleAndBody(path: string, text: string) {
  const body = withoutFrontMatter(text.replace(/\r\n?/g, "\n"));
  const m = /^\s*#\s+(.+)\n?/.exec(body);
  if (m)
    return {
      title: m[1].trim().slice(0, 200),
      markdown: body.slice(m[0].length).replace(/^\n+/, ""),
    };
  return {
    title: cleanImportName(baseName(path)).slice(0, 200),
    markdown: body,
  };
}

/**
 * The shape an export will take in Orbyn: pages in one level of folders
 * (the export's top folders; anything at the top goes in one named after
 * the file), Notion databases as projects with their rows as tasks.
 */
export function planPagesImport(
  files: ImportFile[],
  format: PageImportFormat,
  rootName: string,
  timeZone = "UTC",
): PagesImportPlan {
  const left: Record<string, number> = {};
  const leave = (what: string) => (left[what] = (left[what] ?? 0) + 1);
  const skip = (p: string) =>
    p.startsWith("__MACOSX/") || baseName(p).startsWith(".");
  let usable = files.filter((f) => !skip(f.path));
  // A zip of one folder: that folder is the export, not a folder in it.
  const tops = new Set(
    usable.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")),
  );
  let prefix = "";
  if (tops.size === 1 && !tops.has("")) prefix = `${[...tops][0]}/`;
  usable = usable.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  const root = cleanImportName(rootName.replace(/\.zip$/i, "")) || "Imported";

  const projects: PlannedProject[] = [];
  const rowPages = new Map<string, ImportedTask>();
  if (format === "notion") {
    for (const f of usable.filter((x) => /\.csv$/i.test(x.path))) {
      // Notion writes "<db>.csv" and "<db>_all.csv"; one is enough.
      if (/_all\.csv$/i.test(f.path)) continue;
      const name = cleanImportName(baseName(f.path)) || "Database";
      const rows = csvRecords(parseCsvTable(f.text));
      const tasks: ImportedTask[] = [];
      for (const r of rows) {
        const keys = Object.keys(r);
        const title = (r.name || r.title || r.task || r[keys[0]] || "").slice(
          0,
          200,
        );
        if (!title) continue;
        const status = (r.status || r.done || r.complete || "").toLowerCase();
        const task: ImportedTask = {
          title,
          notes: "",
          status: /^(done|complete|completed|yes|true)$/.test(status)
            ? "done"
            : "todo",
          priority: /high|urgent/i.test(r.priority ?? "")
            ? "high"
            : /low/i.test(r.priority ?? "")
              ? "low"
              : "medium",
          ...dateFields(
            readImportDate(
              (r.due || r["due date"] || r.deadline || r.date || "").replace(
                /\s*→.*$/,
                "",
              ),
              zoneOf("", timeZone),
            ),
            zoneOf("", timeZone),
          ),
          list: null,
          tags: (r.tags || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        };
        tasks.push(task);
        // The row's own page sits in a folder named after the database.
        const dir = f.path.replace(/\.csv$/i, "");
        rowPages.set(`${dir}/${title}`.toLowerCase(), task);
      }
      if (tasks.length) projects.push({ name: name.slice(0, 120), tasks });
    }
  }

  const pages: PlannedPage[] = [];
  const folders = new Set<string>();
  for (const f of usable) {
    if (/\.(md|markdown|txt)$/i.test(f.path)) {
      const { title, markdown } = titleAndBody(f.path, f.text);
      // A Notion database row: its words become its task's notes.
      const dir = f.path.includes("/")
        ? f.path.slice(0, f.path.lastIndexOf("/"))
        : "";
      const row = rowPages.get(`${dir}/${title}`.toLowerCase());
      if (row) {
        row.notes = markdown
          .replace(/^(?:[A-Z][\w ]*: .*\n)+/, "")
          .trim()
          .slice(0, 20_000);
        continue;
      }
      if (pages.length >= PAGE_IMPORT_LIMITS.maxPages) {
        leave("pages past the limit");
        continue;
      }
      const top = f.path.includes("/") ? f.path.split("/")[0] : "";
      const folder = (top ? cleanImportName(top) : root).slice(0, 120) || root;
      folders.add(folder);
      const pictures = (
        markdown.match(/!\[[^\]]*\]\((?!https?:)[^)]*\)/g) ?? []
      ).length;
      for (let n = 0; n < pictures; n++) leave("pictures");
      pages.push({
        path: f.path,
        title: title || "Untitled",
        folder,
        markdown: markdown.slice(0, PAGE_IMPORT_LIMITS.maxPageChars),
      });
    } else if (/\.csv$/i.test(f.path) && format === "notion") continue;
    else if (!f.path.endsWith("/")) leave("other files");
  }
  const words = (what: string, n: number) =>
    what === "pictures"
      ? `${n} picture${n === 1 ? "" : "s"} (add them to the pages after)`
      : what === "other files"
        ? `${n} other file${n === 1 ? "" : "s"}`
        : what === "unread dates"
          ? `${n} task date${n === 1 ? "" : "s"} that couldn't be read (${n === 1 ? "that task comes" : "those tasks come"} in with no date)`
          : what === "repeats"
            ? `${n} repeat${n === 1 ? "" : "s"}`
            : `${n} ${what}`;
  for (const t of projects.flatMap((x) => x.tasks))
    if (t.date_dropped)
      leave(t.date_dropped === "unread" ? "unread dates" : "repeats");
  return {
    folders: [...folders],
    pages,
    projects,
    left_out: Object.entries(left).map(([what, n]) => words(what, n)),
  };
}

/** Normalise a path with ./ and ../ in it. */
function resolvePath(from: string, target: string) {
  const parts = from.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * A page's links made into Orbyn links, now the pages have ids: [[Name]]
 * (and [[Name|shown]], [[Name#Heading]]) by title, and a Markdown link to
 * another file in the export by its path. A link to something that did not
 * come in keeps its words. Returns the Markdown and how many links now work.
 */
export function linkImportedPage(
  page: PlannedPage,
  byPath: Map<string, string>,
  byTitle: Map<string, string>,
): { markdown: string; links: number } {
  let links = 0;
  let text = page.markdown.replace(
    /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g,
    (_m, name: string, shown?: string) => {
      const id = byTitle.get(cleanImportName(name.trim()).toLowerCase());
      const words = (shown ?? name).trim();
      if (!id) return words;
      links++;
      return linkMarkdown({ kind: "doc", id }, words);
    },
  );
  text = text.replace(
    /(!?)\[([^\]\n]*)\]\(([^)\s]+\.(?:md|markdown|txt))(?:#[^)]*)?\)/gi,
    (m, bang: string, words: string, href: string) => {
      if (bang || /^[a-z]+:/i.test(href)) return m;
      let target: string;
      try {
        target = decodeURIComponent(href);
      } catch {
        target = href;
      }
      const id = byPath.get(resolvePath(page.path, target).toLowerCase());
      if (!id) return words;
      links++;
      return linkMarkdown({ kind: "doc", id }, words || "page");
    },
  );
  // Pictures that stayed behind are left as their captions.
  text = text.replace(
    /!\[([^\]]*)\]\((?!https?:)[^)]*\)/g,
    (_m, alt: string) => (alt ? `(${alt})` : ""),
  );
  return { markdown: text, links };
}
