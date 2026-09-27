/**
 * Telling the person what their agents did (H7), in plain words, the same
 * everywhere: Connected agents → Activity, the push when a big job
 * finishes, and the morning digest's "What your agents did".
 *
 * Each change an agent makes is counted by what it made, keyed
 * "verb:kind" ({"added:card": 12, "added:task": 3, "changed:doc": 1}), so
 * a job reads "Claude added 12 cards and 3 tasks in Biology".
 */
import type { AgentActivity } from "./agents.js";

/** A job (or a burst of calls) over this many changes gets a push. */
export const AGENT_REPORT_THRESHOLD = 20;

/**
 * Calls from one connection this close together are one burst of work
 * (minutes); the push waits until the connection has been quiet this long.
 */
export const AGENT_BURST_GAP_MINUTES = 2;

/** What a change did to the things it counts. */
export type AgentChangeVerb = "added" | "finished" | "changed";

const ADDS = new Set([
  "create_tasks",
  "create_doc",
  "create_project",
  "schedule_sessions",
  "save_source",
  "add_file",
  "append_doc",
  "tasks_from_doc",
  "save_template",
  "save_view",
  "save_record",
  "comment_on_doc",
  "add_progress",
  "log_focus",
  "import_tasks",
  "start_import",
]);

/** What a tool's changes did, for counting them in words. */
export function agentToolVerb(tool: string): AgentChangeVerb {
  if (ADDS.has(tool)) return "added";
  if (tool === "complete_tasks") return "finished";
  return "changed";
}

const NOUNS: Record<string, [string, string]> = {
  task: ["task", "tasks"],
  doc: ["page", "pages"],
  card: ["card", "cards"],
  file: ["file", "files"],
  project: ["project", "projects"],
  record: ["record", "records"],
  template: ["template", "templates"],
  page_template: ["page template", "page templates"],
  view: ["view", "views"],
  source: ["source", "sources"],
  habit: ["routine session", "routine sessions"],
  focus: ["focus session", "focus sessions"],
  calendar: ["calendar", "calendars"],
  exam: ["exam", "exams"],
  field: ["field", "fields"],
  team: ["team", "teams"],
  booking: ["booking", "bookings"],
  import: ["import", "imports"],
  settings: ["setting", "settings"],
  question: ["question", "questions"],
};

/** "3 tasks", "1 page"; something without a name of its own is a "thing". */
export function agentKindCount(kind: string, n: number): string {
  const [one, many] = NOUNS[kind] ?? ["other thing", "other things"];
  return `${n} ${n === 1 ? one : many}`;
}

/** Counts added together: a job's changes from its calls'. */
export function mergeAgentKinds(
  list: (Record<string, number> | null | undefined)[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const kinds of list)
    for (const [k, n] of Object.entries(kinds ?? {}))
      if (Number.isFinite(n) && n > 0) out[k] = (out[k] ?? 0) + n;
  return out;
}

/** How many changes the counts add up to. */
export const agentChangeCount = (kinds: Record<string, number> | null) =>
  Object.values(kinds ?? {}).reduce((n, k) => n + k, 0);

const and = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

const VERBS: AgentChangeVerb[] = ["added", "finished", "changed"];

/**
 * The work in words: "added 12 cards and 3 tasks, and changed 1 page".
 * Empty when nothing was changed.
 */
export function agentWorkWords(kinds: Record<string, number> | null): string {
  const byVerb = new Map<AgentChangeVerb, [string, number][]>();
  for (const [key, n] of Object.entries(kinds ?? {})) {
    if (!(n > 0)) continue;
    const [verb, kind] = key.includes(":")
      ? (key.split(":", 2) as [AgentChangeVerb, string])
      : (["changed", key] as [AgentChangeVerb, string]);
    const v = VERBS.includes(verb) ? verb : "changed";
    byVerb.set(v, [...(byVerb.get(v) ?? []), [kind, n]]);
  }
  const phrases = VERBS.filter((v) => byVerb.has(v)).map((v) => {
    const items = byVerb
      .get(v)!
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => agentKindCount(kind, n));
    return `${v} ${and(items)}`;
  });
  return phrases.length > 1
    ? `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`
    : (phrases[0] ?? "");
}

/**
 * A job in one sentence: "Claude added 12 cards and 3 tasks in Biology."
 * `space` is the team it was in, when it was all in one.
 */
export function agentJobText(
  agent: string,
  kinds: Record<string, number> | null,
  space?: string | null,
): string {
  const words = agentWorkWords(kinds);
  const who = agent.trim() || "An agent";
  if (!words) return `${who} made no changes.`;
  return `${who} ${words}${space ? ` in ${space}` : ""}.`;
}

/** One job in a connection's activity: its calls, newest first. */
export type AgentJob = {
  /** The job id (a plan's, or the call's), or the row's id alone. */
  id: string;
  /** Whether it can be undone as a whole (the job route takes it back). */
  job: string | null;
  at: string;
  rows: AgentActivity[];
  kinds: Record<string, number>;
  changes: number;
  /** Some change in it can still be undone. */
  undoable: boolean;
};

/**
 * A connection's activity grouped by job (every call of one apply_plan,
 * or one call's changes), newest first. Calls with no job stand alone.
 */
export function groupAgentActivity(list: AgentActivity[]): AgentJob[] {
  const jobs: AgentJob[] = [];
  const byId = new Map<string, AgentJob>();
  for (const a of list) {
    const key = a.job ? `job:${a.job}` : `row:${a.id}`;
    let j = byId.get(key);
    if (!j) {
      j = {
        id: key,
        job: a.job ?? null,
        at: a.at,
        rows: [],
        kinds: {},
        changes: 0,
        undoable: false,
      };
      byId.set(key, j);
      jobs.push(j);
    }
    j.rows.push(a);
    if (a.at > j.at) j.at = a.at;
    j.kinds = mergeAgentKinds([j.kinds, a.kinds]);
    j.changes += a.changes ?? 0;
    j.undoable ||= a.undoable;
  }
  return jobs;
}
