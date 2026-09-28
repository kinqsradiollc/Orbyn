import type { AssistantChangeKind, GoalCheckin } from "@orbyn/core";

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
};

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
