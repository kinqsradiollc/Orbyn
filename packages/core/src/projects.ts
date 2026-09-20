/**
 * Projects: a named piece of work with ordered stages and the tasks that make
 * it up. Tasks stay ordinary planner items — a project only groups them — so
 * scheduling, the calendar and reminders keep working unchanged.
 */

export const PROJECT_STATUSES = ["active", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectStage = {
  id: string;
  project_id: string;
  name: string;
  position: number;
};

export type Project = {
  id: string;
  user_id: string;
  team_id: string | null;
  team_name?: string | null;
  name: string;
  summary: string;
  status: ProjectStatus;
  deadline: string | null;
  doc_id: string | null;
  created_at: string;
  updated_at: string;
  stages: ProjectStage[];
  /** Tasks in the project, and how many are finished. */
  task_count: number;
  done_count: number;
};

/** Progress as a whole percentage; an empty project reads as 0. */
export const projectProgress = (p: {
  task_count: number;
  done_count: number;
}) =>
  p.task_count === 0 ? 0 : Math.round((p.done_count / p.task_count) * 100);

/**
 * Whether a project needs attention: past its deadline with work left, or
 * due within `soonDays` and less than half finished.
 */
export function projectAtRisk(
  p: { deadline: string | null; task_count: number; done_count: number },
  now = new Date(),
  soonDays = 7,
): boolean {
  if (!p.deadline || p.task_count === 0) return false;
  if (p.done_count >= p.task_count) return false;
  const due = new Date(p.deadline).getTime();
  if (due < now.getTime()) return true;
  const days = (due - now.getTime()) / 86_400_000;
  return days <= soonDays && projectProgress(p) < 50;
}

/** The stages a new project starts with, so a board is never empty. */
export const DEFAULT_STAGES = ["Planning", "In progress", "Review", "Done"];
