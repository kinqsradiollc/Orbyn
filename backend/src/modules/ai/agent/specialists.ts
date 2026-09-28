import { registry } from "../../../capabilities/index.js";
import { PLAN_TOOLS } from "../../../capabilities/plan-run.js";

export const SHARED_ASSISTANT_READS = [
  "search",
  "fetch",
  "query",
  "get_context",
] as const;

export const SPECIALISTS = {
  planner: {
    name: "Planner",
    prompt:
      "Plan work and time. Check the calendar and work patterns before suggesting a schedule. Keep sessions inside the person's stated hours and avoid conflicts. Stage every change; never claim it has been applied.",
    tools: [
      "get_today",
      "get_calendar",
      "plan_schedule",
      "schedule_sessions",
      "reschedule_sessions",
      "find_time",
      "what_if",
      "get_work_patterns",
      "update_planner_settings",
    ],
  },
  study: {
    name: "Study",
    prompt:
      "Help with study decks, revision, quizzes, cards and exams using the person's own pages and Study tools. Practice before revealing answers. Stage all card, exam and schedule changes for one review.",
    tools: ["get_study", "update_study", "plan_revision", "schedule_sessions"],
  },
  writer: {
    name: "Writer",
    prompt:
      "Read the relevant pages and sources before drafting or editing. Keep source links and line anchors intact. Stage page edits, additions and comments; never say a page changed before approval.",
    tools: [
      "create_doc",
      "edit_doc",
      "append_doc",
      "save_source",
      "find_passages",
      "comment_on_doc",
    ],
  },
  projects: {
    name: "Projects",
    prompt:
      "Work within the named project, its stages and decisions. Read the project before creating or changing work. Link tasks to the right stage and open decision where possible. Stage every change for review.",
    tools: [
      "get_project",
      "create_project",
      "update_project",
      "create_tasks",
      "update_tasks",
      "complete_tasks",
      "edit_checklist",
      "link",
    ],
  },
  inbox: {
    name: "Inbox",
    prompt:
      "Review only items and questions reachable by the person. Report what needs attention and why. Never send messages or take an external action; this specialist reads only. Pass choices to the lead as open questions.",
    tools: ["get_inbox", "get_follow_through", "get_bookings"],
  },
  memory: {
    name: "Memory",
    prompt:
      "Use only the person's private Memory. Keep facts concise and grounded in the provided sources. Respect kept-out projects. Stage remember or forget changes for the lead's single review plan.",
    tools: ["manage_memory"],
  },
} as const;

export type SpecialistName = keyof typeof SPECIALISTS;
export type SpecialistDefinition = (typeof SPECIALISTS)[SpecialistName];

/** MCP tools this specialist may call, plus the shared read set. */
export function specialistToolNames(name: SpecialistName): string[] {
  return [...new Set([...SHARED_ASSISTANT_READS, ...SPECIALISTS[name].tools])];
}

/**
 * Fail at startup and in tests if the artifact's allowlist drifts from MCP,
 * or lists a write tool the lead's one apply_plan cannot stage.
 */
export function assertSpecialistTools(): void {
  for (const name of Object.keys(SPECIALISTS) as SpecialistName[]) {
    for (const tool of specialistToolNames(name)) {
      const cap = registry.get(tool);
      if (!cap)
        throw new Error(
          `${SPECIALISTS[name].name} allowlists missing MCP tool ${tool}`,
        );
      if (
        cap.mode !== "read" &&
        !(PLAN_TOOLS as readonly string[]).includes(tool)
      )
        throw new Error(
          `${SPECIALISTS[name].name} allowlists ${tool}, which apply_plan cannot stage`,
        );
    }
  }
}

assertSpecialistTools();
