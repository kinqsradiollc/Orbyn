import { z } from "zod";

export const activitySummaryQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((days) => [30, 90, 365].includes(days))
    .default(90),
});

/** Content-free personal metrics; completions are recorded transitions, never inferred. */
export type ActivitySummary = {
  timezone: string;
  completion_history_since: string;
  days: { day: string; completions: number | null; focus_minutes: number }[];
  totals: { completions: number; focus_minutes: number; active_days: number };
};
