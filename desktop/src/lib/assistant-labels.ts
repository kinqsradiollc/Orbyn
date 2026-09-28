import {
  agentWorkWords,
  type AgentActivity,
  type AssistantChangeKind,
  type ChatTraceEntry,
  type GoalCheckin,
} from "@orbyn/core";

/** Plain words for the tools the assistant uses, by tool id. */
const TOOL_LABELS: Record<string, string> = {
  create_tasks: "Add tasks",
  update_tasks: "Change tasks",
  complete_tasks: "Complete tasks",
  import_tasks: "Import tasks",
  tasks_from_doc: "Make tasks from a page",
  schedule_sessions: "Schedule sessions",
  reschedule_sessions: "Move sessions",
  plan_schedule: "Plan the schedule",
  apply_plan: "Apply the plan",
  find_time: "Find free time",
  create_doc: "Create a page",
  edit_doc: "Edit a page",
  append_doc: "Add to a page",
  comment_on_doc: "Comment on a page",
  edit_checklist: "Edit a checklist",
  create_project: "Create a project",
  update_project: "Change a project",
  manage_memory: "Update memory",
  manage_routines: "Update routines",
  update_study: "Update study",
  save_record: "Save a record",
  save_source: "Save a source",
  save_template: "Save a template",
  save_view: "Save a view",
  link: "Link items",
  organize: "Organize",
  propose_changes: "Suggest changes",
  resolve_suggestions: "Resolve suggestions",
  search: "Search",
  find_passages: "Find passages",
  query: "Look up",
  fetch: "Open a page",
  get_today: "Read today",
  get_calendar: "Read the calendar",
  get_project: "Read a project",
  get_context: "Read context",
  get_history: "Read history",
  ask_person: "Ask you",
  what_if: "Try a what-if",
  set_focus_timer: "Set a focus timer",
  log_focus: "Log focus time",
  undo: "Undo",
  delegate: "Ask a specialist",
  report: "Report back",
  finish: "Wrap up the answer",
  get_links: "Read links",
  get_profile: "Read your profile",
  get_study: "Read study",
  get_team: "Read the team",
  get_inbox: "Read the inbox",
  get_bookings: "Read bookings",
  get_follow_through: "Read follow-through",
  get_work_patterns: "Read work patterns",
  list_agent_changes: "Read recent changes",
  list_imports: "Read imports",
  start_import: "Start an import",
  cancel_import: "Cancel an import",
  add_file: "Add a file",
  add_progress: "Log progress",
  booking_action: "Update a booking",
  plan_revision: "Plan revision",
  update_agent: "Update an agent",
  update_planner_settings: "Change planner settings",
  ack_inbox: "Clear the inbox",
  answer_ask: "Answer a question",
};

/** The first word of a tool label while it runs, and once it has. */
const VERB_FORMS: Record<string, [doing: string, done: string]> = {
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

function verbForm(label: string, form: 0 | 1): string {
  const [first, ...rest] = label.split(" ");
  const forms = VERB_FORMS[first];
  return forms ? [forms[form], ...rest].join(" ") : label;
}

/** A tool while it runs, in plain words ("create_tasks" → "Adding tasks"). */
export function toolDoingLabel(tool: string): string {
  return verbForm(toolLabel(tool), 0);
}

/** A tool once it has run, in plain words ("create_tasks" → "Added tasks"). */
export function toolDoneLabel(tool: string): string {
  return verbForm(toolLabel(tool), 1);
}

/** A tool id in plain words ("create_tasks" → "Add tasks"). */
export function toolLabel(tool: string): string {
  const known = TOOL_LABELS[tool];
  if (known) return known;
  const words = tool
    .replace(/[_.:-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : "Change";
}

/** The tool named by one staged step, in plain words. */
export function stepLabel(step: unknown): string {
  return step && typeof step === "object" && "tool" in step
    ? toolLabel(String(step.tool))
    : "Change";
}

/** Plain words for a kind of change the assistant may make without asking. */
export const CHANGE_KIND_LABELS: Record<AssistantChangeKind, string> = {
  tasks: "Tasks",
  sessions: "Calendar sessions",
  pages: "Pages",
  projects: "Projects",
  memory: "Memory",
  study: "Study",
  other: "Other changes",
};

/** A change kind in plain words, lower case, for use inside a sentence. */
export function changeKindWords(kinds: string[]): string {
  return kinds
    .map((k) =>
      (CHANGE_KIND_LABELS[k as AssistantChangeKind] ?? k).toLowerCase(),
    )
    .join(", ");
}

/** A goal check-in's status in plain words. */
export function checkinStatusLabel(status: GoalCheckin["status"]): string {
  return status === "done"
    ? "Done"
    : status === "running"
      ? "In progress"
      : status === "failed"
        ? "Didn't finish"
        : "Scheduled";
}

/** A day key ("2026-09-28") as a short date ("Mon, 28 Sept"). */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

type ParsedStep = {
  /** The specialist that took the step ("Projects"), if one did. */
  who: string;
  kind: "start" | "finish" | "staged" | "report" | "other";
  tool: string;
  text: string;
};

/** One run label ("Projects: Using create_tasks") taken apart. */
function parseStep(label: string): ParsedStep {
  const match = /^([A-Z][A-Za-z ]{1,30}): (.+)$/.exec(label.trim());
  const who = match ? match[1] : "";
  const rest = match ? match[2] : label.trim();
  const tool = /^(?:Using|Finished|staged) ([\w.:-]+)$/i.exec(rest)?.[1] ?? "";
  const kind: ParsedStep["kind"] = /^Using /.test(rest)
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

function stepWords(step: ParsedStep, done: boolean): string {
  const words =
    step.kind === "start" || step.kind === "finish"
      ? done
        ? toolDoneLabel(step.tool)
        : toolDoingLabel(step.tool)
      : step.kind === "staged"
        ? `Drafted for your review: ${toolLabel(step.tool).toLowerCase()}`
        : step.kind === "report"
          ? toolDoneLabel("report")
          : step.text;
  return step.who ? `${step.who}: ${words}` : words;
}

/**
 * The progress line a running reply shows, in plain words
 * ("Projects: Using create_tasks" → "Projects: Adding tasks").
 */
export function progressText(label: string | undefined): string {
  if (!label?.trim()) return "";
  const step = parseStep(label);
  return stepWords(step, step.kind === "finish" || step.kind === "report");
}

/**
 * A reply's steps as plain lines: a tool's start and finish become one line,
 * tool ids become words, and repeats are left out.
 */
export function traceLines(
  entries: Pick<ChatTraceEntry, "kind" | "label" | "tool">[],
): string[] {
  const steps = entries.map((e) => parseStep(e.label));
  const used = new Set<number>();
  const lines: string[] = [];
  const thoughts = new Set<string>();
  steps.forEach((step, i) => {
    if (used.has(i)) return;
    let done = step.kind === "finish" || step.kind === "report";
    if (step.kind === "start") {
      const end = steps.findIndex(
        (s, j) =>
          j > i &&
          !used.has(j) &&
          s.kind === "finish" &&
          s.tool === step.tool &&
          s.who === step.who,
      );
      if (end >= 0) {
        used.add(end);
        done = true;
      }
    }
    const line = stepWords(step, done);
    if (entries[i].kind === "thinking") {
      if (thoughts.has(line)) return;
      thoughts.add(line);
    }
    if (lines[lines.length - 1] === line) return;
    lines.push(line);
  });
  return lines;
}

/**
 * What one reply changed, one line per real change: the wrapper row of an
 * applied plan is left out when its steps are listed themselves.
 */
export function visibleChanges(changes: AgentActivity[]): AgentActivity[] {
  const steps = changes.filter((c) => c.tool !== "apply_plan");
  return steps.length ? steps : changes;
}

/** One change in plain words ("Added 2 tasks"), without internal step ids. */
export function changeLine(change: AgentActivity): string {
  const words = agentWorkWords(change.kinds ?? null);
  if (words) return words[0].toUpperCase() + words.slice(1);
  return change.summary.replace(/\s*\(plan step [^)]*\)/gi, "").trim();
}
