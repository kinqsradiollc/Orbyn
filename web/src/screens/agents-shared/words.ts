import {
  agentWorkWords,
  ASSISTANT_OUTCOME_LABELS,
  type AgentActivity,
  type AssistantChangeKind,
  type AssistantConversationEntry,
  type AssistantOutcomeReceipt,
  type ChatTraceEntry,
  type GoalCheckin,
} from "@orbyn/core";

/** Runs can only be read from structured fields, never from their prose. */
export type Tone = "blue" | "red" | "amber" | "green" | undefined;

const TOOLS: Record<string, string> = {
  add_file: "Add a file",
  add_progress: "Log progress",
  ack_inbox: "Clear the inbox",
  answer_ask: "Answer a question",
  append_doc: "Add to a page",
  apply_plan: "Apply the plan",
  ask_person: "Ask you",
  booking_action: "Update a booking",
  cancel_import: "Cancel an import",
  comment_on_doc: "Comment on a page",
  complete_tasks: "Complete tasks",
  create_doc: "Create a page",
  create_project: "Create a project",
  create_tasks: "Add tasks",
  delegate: "Ask a specialist",
  edit_checklist: "Edit a checklist",
  edit_doc: "Edit a page",
  fetch: "Open a page",
  find_passages: "Find passages",
  find_time: "Find free time",
  finish: "Wrap up the answer",
  get_bookings: "Read bookings",
  get_calendar: "Read the calendar",
  get_context: "Read context",
  get_follow_through: "Read follow-through",
  get_history: "Read history",
  get_inbox: "Read the inbox",
  get_links: "Read links",
  get_profile: "Read your profile",
  get_project: "Read a project",
  get_study: "Read study",
  get_team: "Read the team",
  get_today: "Read today",
  get_work_patterns: "Read work patterns",
  import_tasks: "Import tasks",
  link: "Link items",
  list_agent_changes: "Read recent changes",
  list_imports: "Read imports",
  log_focus: "Log focus time",
  manage_memory: "Update memory",
  manage_routines: "Update routines",
  organize: "Organize",
  plan_revision: "Plan revision",
  plan_schedule: "Plan the schedule",
  propose_changes: "Suggest changes",
  query: "Look up",
  report: "Report back",
  reschedule_sessions: "Move sessions",
  resolve_suggestions: "Resolve suggestions",
  save_record: "Save a record",
  save_source: "Save a source",
  save_template: "Save a template",
  save_view: "Save a view",
  schedule_sessions: "Schedule sessions",
  search: "Search",
  set_focus_timer: "Set a focus timer",
  start_import: "Start an import",
  tasks_from_doc: "Make tasks from a page",
  undo: "Undo",
  update_agent: "Update an agent",
  update_planner_settings: "Change planner settings",
  update_project: "Change a project",
  update_study: "Update study",
  update_tasks: "Change tasks",
  what_if: "Try a what-if",
};

const VERBS: Record<string, [doing: string, done: string]> = {
  Add: ["Adding", "Added"],
  Answer: ["Answering", "Answered"],
  Apply: ["Applying", "Applied"],
  Ask: ["Asking", "Asked"],
  Cancel: ["Cancelling", "Cancelled"],
  Change: ["Changing", "Changed"],
  Clear: ["Clearing", "Cleared"],
  Comment: ["Commenting", "Commented"],
  Complete: ["Completing", "Completed"],
  Create: ["Creating", "Created"],
  Edit: ["Editing", "Edited"],
  Find: ["Finding", "Found"],
  Import: ["Importing", "Imported"],
  Link: ["Linking", "Linked"],
  Log: ["Logging", "Logged"],
  Look: ["Looking", "Looked"],
  Make: ["Making", "Made"],
  Move: ["Moving", "Moved"],
  Open: ["Opening", "Opened"],
  Organize: ["Organizing", "Organized"],
  Plan: ["Planning", "Planned"],
  Read: ["Reading", "Read"],
  Report: ["Reporting", "Reported"],
  Resolve: ["Resolving", "Resolved"],
  Save: ["Saving", "Saved"],
  Schedule: ["Scheduling", "Scheduled"],
  Search: ["Searching", "Searched"],
  Set: ["Setting", "Set"],
  Start: ["Starting", "Started"],
  Suggest: ["Suggesting", "Suggested"],
  Try: ["Trying", "Tried"],
  Undo: ["Undoing", "Undid"],
  Update: ["Updating", "Updated"],
  Wrap: ["Wrapping", "Wrapped"],
};

export function toolWords(tool: string) {
  const known = TOOLS[tool];
  if (known) return known;
  const words = tool
    .replace(/[_.:-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "Change";
}

const conjugate = (label: string, form: 0 | 1) => {
  const [first, ...rest] = label.split(" ");
  return VERBS[first] ? [VERBS[first][form], ...rest].join(" ") : label;
};

/** The tool named by one staged step. */
export const stepWords = (step: unknown) =>
  step && typeof step === "object" && "tool" in step
    ? toolWords(String(step.tool))
    : "Change";

export const CHANGE_KINDS: Record<AssistantChangeKind, string> = {
  tasks: "Tasks",
  sessions: "Calendar sessions",
  pages: "Pages",
  projects: "Projects",
  memory: "Memory",
  study: "Study",
  other: "Other changes",
};

export const changeKindList = (kinds: string[]) =>
  kinds
    .map((kind) =>
      (CHANGE_KINDS[kind as AssistantChangeKind] ?? kind).toLowerCase(),
    )
    .join(", ");

export const checkinWords = (status: GoalCheckin["status"]) =>
  status === "done"
    ? "Done"
    : status === "running"
      ? "In progress"
      : status === "failed"
        ? "Didn't finish"
        : "Scheduled";

export function dayWords(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

type Step = {
  who: string;
  kind: "start" | "finish" | "staged" | "report" | "other";
  tool: string;
  text: string;
};

/** One run label ("Projects: Using create_tasks") taken apart. */
function readStep(label: string): Step {
  const named = /^([A-Z][A-Za-z ]{1,30}): (.+)$/.exec(label.trim());
  const who = named ? named[1] : "";
  const rest = named ? named[2] : label.trim();
  const tool = /^(?:Using|Finished|staged) ([\w.:-]+)$/i.exec(rest)?.[1] ?? "";
  const kind = /^Using /.test(rest)
    ? "start"
    : /^Finished /.test(rest)
      ? "finish"
      : /^staged /i.test(rest)
        ? "staged"
        : /^report ready$/i.test(rest)
          ? "report"
          : "other";
  return { who, kind, tool, text: rest };
}

function sayStep(step: Step, done: boolean) {
  const words =
    step.kind === "start" || step.kind === "finish"
      ? conjugate(toolWords(step.tool), done ? 1 : 0)
      : step.kind === "staged"
        ? `Drafted for your review: ${toolWords(step.tool).toLowerCase()}`
        : step.kind === "report"
          ? conjugate(toolWords("report"), 1)
          : step.text;
  return step.who ? `${step.who}: ${words}` : words;
}

/** The progress line of a running reply. */
export function progressWords(label: string | undefined) {
  if (!label?.trim()) return "";
  const step = readStep(label);
  return sayStep(step, step.kind === "finish" || step.kind === "report");
}

/** A reply's steps: a tool's start and finish become one line, repeats go. */
export function traceWords(
  entries: Pick<ChatTraceEntry, "kind" | "label" | "tool">[],
) {
  const steps = entries.map((entry) => readStep(entry.label));
  const used = new Set<number>();
  const lines: string[] = [];
  const thoughts = new Set<string>();
  steps.forEach((step, index) => {
    if (used.has(index)) return;
    let done = step.kind === "finish" || step.kind === "report";
    if (step.kind === "start") {
      const end = steps.findIndex(
        (other, at) =>
          at > index &&
          !used.has(at) &&
          other.kind === "finish" &&
          other.tool === step.tool &&
          other.who === step.who,
      );
      if (end >= 0) {
        used.add(end);
        done = true;
      }
    }
    const line = sayStep(step, done);
    if (entries[index].kind === "thinking") {
      if (thoughts.has(line)) return;
      thoughts.add(line);
    }
    if (lines.at(-1) !== line) lines.push(line);
  });
  return lines;
}

/** One line per real change: an applied plan's wrapper row goes when its steps show. */
export function realChanges(changes: AgentActivity[]) {
  const steps = changes.filter((change) => change.tool !== "apply_plan");
  return steps.length ? steps : changes;
}

export function changeWords(change: AgentActivity) {
  const words = agentWorkWords(change.kinds ?? null);
  if (words) return words[0].toUpperCase() + words.slice(1);
  return change.summary.replace(/\s*\(plan step [^)]*\)/gi, "").trim();
}

type Update = Extract<AssistantConversationEntry, { kind: "update" }>;

/** A delivery describes available work, never acceptance of a goal. */
export function updateWords(entry: Update) {
  if (entry.event === "failure") return "Run failed";
  if (entry.event === "question") {
    if (entry.actionable === false) return "Question closed";
    return entry.waiting_kind === "approval"
      ? "Waiting for approval"
      : entry.waiting_kind === "person"
        ? "Waiting for you"
        : "Waiting for a decision";
  }
  return entry.event === "morning_summary"
    ? "Morning review"
    : "Result ready for review";
}

/** Only structured run flags and trace kinds count; prose is not a status. */
export function replyWords(reply: {
  state: "pending" | "applied" | "discarded" | "info";
  trace: readonly ChatTraceEntry[];
  execution?: "stopped" | "timed_out";
  executionOutcome?: AssistantOutcomeReceipt;
}) {
  if (reply.executionOutcome)
    return ASSISTANT_OUTCOME_LABELS[reply.executionOutcome.outcome];
  if (reply.execution === "stopped") return "Run stopped";
  if (reply.execution === "timed_out") return "Run timed out";
  if (reply.trace.some((entry) => entry.kind === "error"))
    return "Run reported errors";
  if (reply.state === "pending") return "Changes waiting for review";
  if (reply.state === "applied") return "Changes applied";
  if (reply.state === "discarded") return "Changes discarded";
  return "Response ready";
}

/** Decisions and failures come first without rewriting retained history. */
export function nightRunsInOrder(entry: Update) {
  const rank = {
    waiting: 0,
    failed: 1,
    cancelled: 2,
    running: 3,
    queued: 4,
    done: 5,
  };
  return [...(entry.night_runs ?? [])].sort(
    (a, b) => rank[a.state] - rank[b.state],
  );
}

export const nightRunWords: Record<
  NonNullable<Update["night_runs"]>[number]["state"],
  string
> = {
  done: "Run finished",
  waiting: "Needs you",
  failed: "Couldn't finish",
  cancelled: "Stopped",
  queued: "Queued",
  running: "Working",
};

const NEEDS_REVIEW = [
  "partial",
  "waiting",
  "failed",
  "interrupted",
  "uncertain",
];

/** Whether a recorded outcome still wants a person's eye. */
export const outcomeNeedsReview = (
  receipt: AssistantOutcomeReceipt | undefined,
) => !!receipt && NEEDS_REVIEW.includes(receipt.outcome);

export const outcomeTone = (
  outcome: AssistantOutcomeReceipt["outcome"] | undefined,
): Tone =>
  outcome === "completed"
    ? "green"
    : outcome === "failed" || outcome === "interrupted"
      ? "red"
      : outcome === "waiting" ||
          outcome === "partial" ||
          outcome === "uncertain"
        ? "amber"
        : undefined;

/** The label of a job that may be live, finished, or asked to stop. */
export function runWords(run: {
  state: "queued" | "running" | "waiting" | "done" | "failed";
  outcome?: AssistantOutcomeReceipt;
  stopping?: boolean;
  recovering?: boolean;
  finished?: string;
}): { text: string; tone: Tone } {
  const live = ["queued", "running", "waiting"].includes(run.state);
  if (live && run.stopping)
    return { text: "Stop requested · Awaiting confirmation", tone: "amber" };
  if (live && run.recovering)
    return { text: "Recovery pending", tone: "amber" };
  if (run.state === "queued") return { text: "Queued", tone: undefined };
  if (run.state === "running") return { text: "Running", tone: "blue" };
  if (run.state === "waiting")
    return { text: "Waiting for you", tone: "amber" };
  if (run.outcome)
    return {
      text: ASSISTANT_OUTCOME_LABELS[run.outcome.outcome],
      tone: outcomeTone(run.outcome.outcome),
    };
  if (run.state === "failed") return { text: "Run failed", tone: "red" };
  return {
    text: run.finished ?? "Run finished · Review outcome",
    tone: undefined,
  };
}

export const when = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });

export const uuid = () => crypto.randomUUID();
export const unavailable = (error: unknown) =>
  [401, 403, 404].includes((error as { statusCode?: number }).statusCode ?? 0);
