import { z } from "zod";

const task = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-zA-Z0-9_-]+$/),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).default(""),
    estimate_minutes: z.number().int().min(5).max(10080),
    due_in_days: z.number().int().min(0).max(365),
    depends_on: z.array(z.string().min(1).max(60)).max(14).default([]),
  })
  .strict();

export const projectDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    tasks: z.array(task).min(1).max(15),
  })
  .strict();

export type ProjectDraft = z.infer<typeof projectDraftSchema>;

import type { PlannedBlock, UnplacedTask } from "./types.js";

/** A project and its proposed schedule; temporary task ids are resolved on approval. */
export type ProjectDecomposition = ProjectDraft & {
  timezone: string;
  start_date: string;
  days: number;
  blocks: PlannedBlock[];
  unplaced: UnplacedTask[];
  at_risk: UnplacedTask[];
  planned_minutes: number;
  capacity_minutes: number;
};
