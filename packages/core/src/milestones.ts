import { z } from "zod";
import { addDays, dayTime } from "./time.js";

/**
 * Milestones: named, dated checkpoints in a project, in their own list. A
 * task can belong to one milestone of its project, and the milestone rolls
 * up its tasks' planned finish. Milestones are not dates on stages (stages
 * are workflow columns that cards move between), and they never write a
 * task's deadline.
 */

/** Where a milestone stands, for its chip. */
export const MILESTONE_STATUSES = [
  "done",
  "on_track",
  "not_planned",
  "late",
  "passed",
  "empty",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export type ProjectMilestone = {
  id: string;
  project_id: string;
  name: string;
  /** The day it falls on, "YYYY-MM-DD". */
  due_on: string;
  /** Marked done by hand, or null. */
  done_at: string | null;
  created_at: string;
  updated_at: string;
  /** Its tasks (cancelled ones left out), and how many are finished. */
  task_count: number;
  done_count: number;
  /** Your part: time still needed and time planned before each task's deadline. */
  needed_minutes: number;
  planned_minutes: number;
  /** When your last counted session for it ends, once all of it is planned. */
  planned_finish_at: string | null;
  /** Your open tasks in it with no estimate (their time can't be counted). */
  unestimated_count: number;
  status: MilestoneStatus;
};

const day = z.iso.date();

export const milestoneInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    due_on: day,
    /** Tasks of the project to put in it now. */
    item_ids: z.array(z.uuid()).max(200).optional(),
  })
  .strict();
export type MilestoneInput = z.input<typeof milestoneInput>;

export const milestoneUpdate = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    due_on: day.optional(),
    /** Mark it done (or not) by hand. */
    done: z.boolean().optional(),
  })
  .strict();
export type MilestoneUpdate = z.input<typeof milestoneUpdate>;

/** `PUT /items/:id/milestone`. */
export const itemMilestoneInput = z
  .object({ milestone_id: z.uuid().nullable() })
  .strict();

/** The moment a milestone's day ends, in `timeZone`. */
export const milestoneEnd = (dueOn: string, timeZone: string) =>
  dayTime(addDays(dueOn, 1), 0, timeZone);

/** Where a milestone stands, from its roll-up. */
export function milestoneStatus(
  m: Pick<
    ProjectMilestone,
    | "due_on"
    | "done_at"
    | "task_count"
    | "done_count"
    | "needed_minutes"
    | "planned_finish_at"
    | "unestimated_count"
  >,
  now: Date,
  timeZone: string,
): MilestoneStatus {
  if (m.done_at || (m.task_count > 0 && m.done_count === m.task_count))
    return "done";
  if (m.task_count === 0) return "empty";
  const end = milestoneEnd(m.due_on, timeZone).getTime();
  if (end <= now.getTime()) return "passed";
  // Nothing of yours left to do in it: your part is on track.
  if (m.needed_minutes === 0 && m.unestimated_count === 0) return "on_track";
  if (!m.planned_finish_at) return "not_planned";
  return Date.parse(m.planned_finish_at) <= end ? "on_track" : "late";
}

/** A milestone's chip, in plain words. */
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  done: "Done",
  on_track: "On track",
  not_planned: "Not fully planned",
  late: "Planned to finish after it",
  passed: "Date passed",
  empty: "No tasks yet",
};
