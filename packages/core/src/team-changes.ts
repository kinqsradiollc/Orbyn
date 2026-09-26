/**
 * Recent changes per team (SHR-02): who created, edited, finished or deleted
 * which of a team's pages and tasks, grouped by day, so a team can catch up
 * after a weekend. "Hide my changes" is on by default: what you did yourself
 * is rarely news.
 */

export type TeamChangeKind = "page" | "task" | "event";

export type TeamChangeAction =
  "created" | "edited" | "done" | "reopened" | "deleted" | "restored";

export type TeamChange = {
  id: string;
  team_id: string;
  team_name: string;
  /** Who made it; null once they are gone. */
  user_id: string | null;
  user_name: string | null;
  kind: TeamChangeKind;
  object_id: string;
  title: string;
  action: TeamChangeAction;
  /** Edits folded into this entry (a burst of typing is one entry). */
  edits: number;
  /** When the burst started, and when it last moved on. */
  first_at: string;
  at: string;
  /** Whether it can still be opened (not deleted since). */
  open: boolean;
};

export type TeamChangesPage = {
  changes: TeamChange[];
  /** Pass as `before` for the next page; null at the end. */
  next: string | null;
};

const VERBS: Record<TeamChangeAction, string> = {
  created: "added",
  edited: "edited",
  done: "finished",
  reopened: "reopened",
  deleted: "deleted",
  restored: "restored",
};

const NOUNS: Record<TeamChangeKind, string> = {
  page: "page",
  task: "task",
  event: "event",
};

/**
 * One entry in words: "Anna edited" and what it was, with "5 edits" for a
 * burst. The title is shown on its own, so this is the part before it.
 */
export function changeVerb(
  c: Pick<TeamChange, "user_name" | "action" | "kind">,
) {
  const who = c.user_name ?? "Someone who left";
  return `${who} ${VERBS[c.action]} the ${NOUNS[c.kind]}`;
}

export const changeEdits = (c: Pick<TeamChange, "edits" | "action">) =>
  c.action === "edited" && c.edits > 1 ? `${c.edits} edits` : "";

/** A day's key in a time zone: "2026-09-27". */
function dayKey(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Today", "Yesterday", or "Fri 25 Sep". */
export function changeDayLabel(
  iso: string,
  timeZone: string,
  now = new Date(),
): string {
  const day = dayKey(iso, timeZone);
  const today = dayKey(now.toISOString(), timeZone);
  const yesterday = dayKey(
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeZone,
  );
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  // Built from parts: "Fri 25 Sep" whatever the platform's month spelling.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** The changes grouped by the day they happened on, newest first. */
export function groupChangesByDay(
  changes: TeamChange[],
  timeZone: string,
  now = new Date(),
): { day: string; label: string; changes: TeamChange[] }[] {
  const out: { day: string; label: string; changes: TeamChange[] }[] = [];
  for (const c of [...changes].sort((a, b) => b.at.localeCompare(a.at))) {
    const day = dayKey(c.at, timeZone);
    const last = out[out.length - 1];
    if (last?.day === day) last.changes.push(c);
    else
      out.push({
        day,
        label: changeDayLabel(c.at, timeZone, now),
        changes: [c],
      });
  }
  return out;
}

/** The time of a change, "14:05", in the reader's time zone. */
export const changeTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
