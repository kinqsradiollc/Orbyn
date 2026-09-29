import { z } from "zod";
import type { AgentActivity } from "./agents.js";
import type { ReviewItem } from "./review.js";

export type OvernightRun = {
  id: string;
  job_id: string;
  chat_id: string | null;
  kind: string;
  title: string;
  summary: string;
  status: "kept" | "undone" | "partly" | "pending";
  state: "queued" | "running" | "waiting" | "done" | "failed";
  question: { text: string; choices: string[] } | null;
  approval: { text: string; summary: string; detail: string } | null;
  proposal: ReviewItem | null;
  steps: { id: string; title: string }[];
  changes: AgentActivity[];
};
export type OvernightNight = {
  id: string;
  local_day: string;
  status: "running" | "done";
  budget_used: number;
  runs: OvernightRun[];
  not_done: { title: string; reason: string }[];
};
export const overnightKeepInput = z
  .object({
    only: z.array(z.number().int().min(0).max(99)).min(1).max(100).optional(),
    steps: z.array(z.string().min(1).max(80)).min(1).max(50).optional(),
  })
  .strict();
export const overnightUndoInput = z
  .object({
    changes: z
      .array(z.string().regex(/^\d{1,18}$/))
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();
