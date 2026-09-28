import { z } from "zod";
export const GOAL_STATUSES = ["active", "paused", "done"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const goalInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    target: z.string().trim().max(2000).default(""),
    target_date: z.iso.date().nullable().default(null),
    plan_doc_id: z.uuid().nullable().default(null),
    project_id: z.uuid().nullable().default(null),
    status: z.enum(GOAL_STATUSES).default("active"),
  })
  .strict();

export const goalUpdate = z
  .object({
    title: goalInput.shape.title.optional(),
    target: goalInput.shape.target.removeDefault().optional(),
    target_date: goalInput.shape.target_date.removeDefault().optional(),
    plan_doc_id: goalInput.shape.plan_doc_id.removeDefault().optional(),
    project_id: goalInput.shape.project_id.removeDefault().optional(),
    status: goalInput.shape.status.removeDefault().optional(),
  })
  .strict();
export type GoalInput = z.input<typeof goalInput>;
export type GoalUpdate = z.input<typeof goalUpdate>;

export type Goal = {
  id: string;
  user_id: string;
  title: string;
  target: string;
  target_date: string | null;
  plan_doc_id: string | null;
  plan_title: string | null;
  project_id: string | null;
  project_name: string | null;
  status: GoalStatus;
  progress: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type GoalCheckin = {
  id: string;
  goal_id: string;
  week_of: string;
  summary: string;
  progress: Record<string, unknown>;
  status: "scheduled" | "running" | "done" | "failed";
  created_at: string;
};
