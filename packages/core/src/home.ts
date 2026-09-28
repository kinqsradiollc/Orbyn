import { z } from "zod";
import type { DocBlock } from "./docs.js";

/**
 * Home (W1): the greeting, hubs of quick links, and a row of three panels —
 * goals, routines and a reflection line for the day. `GET /me/home` answers
 * the panels in one read; the layout itself lives in the account's prefs.
 */

/** One active goal as Home shows it. */
export type HomeGoal = {
  id: string;
  title: string;
  /** Share done (0–1): its project's finished tasks, or its plan's ticks; null with no measure. */
  progress: number | null;
  /** What the share counts, in words ("4 of 10 tasks"), or null. */
  progress_label: string | null;
  /** The Monday its next weekly check-in is due (YYYY-MM-DD); null while paused. */
  next_checkin: string | null;
  target_date: string | null;
};

/** One scheduled assistant routine, by its next run. */
export type HomeRoutine = {
  id: string;
  /** The routine's instruction, as its name. */
  name: string;
  next_run_at: string;
  timezone: string;
};

/** What `GET /me/home` answers. */
export type HomeSummary = {
  /** Today in the person's zone (YYYY-MM-DD), and the zone. */
  today: string;
  timezone: string;
  goals: HomeGoal[];
  routines: HomeRoutine[];
  /** Today's morning brief (an Agent note), when one was written. */
  brief: { doc_id: string; title: string; overnight?: string | null } | null;
  /** Today's agenda page, when it has been written. */
  agenda_doc_id: string | null;
  /** Lines already under Reflection on today's agenda. */
  reflection: string[];
};

/** "How did today go?": one line for today's agenda. */
export const reflectionInput = z
  .object({ text: z.string().trim().min(1).max(500) })
  .strict();
export type ReflectionInput = z.infer<typeof reflectionInput>;

/** The heading reflection lines go under on the agenda. */
export const REFLECTION_HEADING = "Reflection";

const isHeading = (b: DocBlock): b is Extract<DocBlock, { type: "heading" }> =>
  b.type === "heading";

/** Where the Reflection section starts and ends (end is exclusive), or null. */
function reflectionSection(blocks: DocBlock[]) {
  const at = blocks.findIndex(
    (b) =>
      isHeading(b) &&
      b.text.trim().toLowerCase() === REFLECTION_HEADING.toLowerCase(),
  );
  if (at < 0) return null;
  const level = (blocks[at] as { level: number }).level;
  let end = at + 1;
  while (
    end < blocks.length &&
    !(
      isHeading(blocks[end]) &&
      (blocks[end] as { level: number }).level <= level
    )
  )
    end++;
  return { at, end };
}

/**
 * The page with `line` added under its Reflection heading, after what is
 * already there; a Reflection heading is added at the end when there is
 * none. Nothing else on the page moves.
 */
export function appendReflection(blocks: DocBlock[], line: string): DocBlock[] {
  const text = line.trim().replace(/\s+/g, " ");
  const bullet: DocBlock = { type: "bullet", text };
  const found = reflectionSection(blocks);
  if (!found) {
    // A page ending in one empty line (as a new page does) loses it.
    const body =
      blocks.length &&
      blocks[blocks.length - 1].type === "paragraph" &&
      !(blocks[blocks.length - 1] as { text: string }).text.trim()
        ? blocks.slice(0, -1)
        : blocks;
    return [
      ...body,
      { type: "heading", level: 2, text: REFLECTION_HEADING },
      bullet,
    ];
  }
  // After the section's last line with words, so a trailing blank stays last.
  let at = found.end;
  while (
    at > found.at + 1 &&
    "text" in blocks[at - 1] &&
    !(blocks[at - 1] as { text: string }).text.trim()
  )
    at--;
  return [...blocks.slice(0, at), bullet, ...blocks.slice(at)];
}

/** The lines under the Reflection heading, as written. */
export function reflectionLines(blocks: DocBlock[]): string[] {
  const found = reflectionSection(blocks);
  if (!found) return [];
  return blocks
    .slice(found.at + 1, found.end)
    .map((b) => ("text" in b ? (b as { text: string }).text.trim() : ""))
    .filter(Boolean);
}

/** The lines of a page that can be a quote: words, not headings or code. */
export function homeQuoteLines(blocks: DocBlock[]): string[] {
  return blocks
    .filter((b) =>
      ["paragraph", "bullet", "numbered", "quote", "callout"].includes(b.type),
    )
    .map((b) => (b as { text: string }).text.trim())
    .filter((t) => t.length > 0 && t.length <= 400);
}

/** One line, chosen by `random` (0–1), or null for a page without any. */
export function pickQuote(
  blocks: DocBlock[],
  random: number = Math.random(),
): string | null {
  const lines = homeQuoteLines(blocks);
  if (!lines.length) return null;
  return lines[Math.min(lines.length - 1, Math.floor(random * lines.length))];
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "June",
  "July",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A friendly date: "Mon 28 Sept", in the given zone (the device's if left out). */
export function friendlyDate(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "numeric",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const weekday = get("weekday") ?? "";
  const day = Number(get("day"));
  const month = Number(get("month"));
  const dayName =
    SHORT_DAYS.find((d) => weekday.startsWith(d.slice(0, 3))) ?? weekday;
  return `${dayName} ${day} ${SHORT_MONTHS[month - 1] ?? ""}`.trim();
}

/** "Good morning", "Good afternoon" or "Good evening", by the hour. */
export function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** A day key (YYYY-MM-DD) as a friendly date: "Mon 5 Oct". */
export function friendlyDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return friendlyDate(new Date(Date.UTC(y, m - 1, d, 12)), "UTC");
}
