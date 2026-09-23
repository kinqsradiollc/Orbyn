import { z } from "zod";

/** Records people deliberately keep beside their work. */
export const WORK_RECORD_KINDS = [
  "promise",
  "decision",
  "experiment",
  "meeting_outcome",
] as const;
export type WorkRecordKind = (typeof WORK_RECORD_KINDS)[number];

export const WORK_RECORD_STATUSES = [
  "proposed",
  "open",
  "done",
  "declined",
  "superseded",
] as const;
export type WorkRecordStatus = (typeof WORK_RECORD_STATUSES)[number];

const optionalDate = z.iso.datetime({ offset: true }).nullable();

export const workRecordInput = z
  .object({
    kind: z.enum(WORK_RECORD_KINDS),
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().max(4000).default(""),
    team_id: z.uuid().nullable().default(null),
    project_id: z.uuid().nullable().default(null),
    owner_id: z.uuid().optional(),
    due_at: optionalDate.default(null),
    review_at: optionalDate.default(null),
    source_doc_id: z.uuid().nullable().default(null),
    source_block_id: z.string().trim().min(1).max(64).nullable().default(null),
    source_item_id: z.uuid().nullable().default(null),
    linked_item_id: z.uuid().nullable().default(null),
    meeting_minutes: z.number().int().min(1).max(1440).nullable().default(null),
    participant_count: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (d) => (d.meeting_minutes === null) === (d.participant_count === null),
    "Enter both meeting length and participant count.",
  )
  .refine(
    (d) => d.kind === "meeting_outcome" || d.meeting_minutes === null,
    "Meeting effort belongs to a meeting outcome.",
  );

export const workRecordUpdate = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    details: z.string().trim().max(4000).optional(),
    status: z.enum(WORK_RECORD_STATUSES).optional(),
    due_at: optionalDate.optional(),
    review_at: optionalDate.optional(),
    linked_item_id: z.uuid().nullable().optional(),
    outcome: z.string().trim().max(4000).optional(),
  })
  .strict();

export const workRecordResponse = z
  .object({ decision: z.enum(["accept", "decline"]) })
  .strict();

export type WorkRecordInput = z.input<typeof workRecordInput>;
export type WorkRecordUpdate = z.input<typeof workRecordUpdate>;
export type WorkRecord = {
  id: string;
  created_by: string;
  owner_id: string | null;
  owner_name: string;
  team_id: string | null;
  project_id: string | null;
  kind: WorkRecordKind;
  title: string;
  details: string;
  status: WorkRecordStatus;
  due_at: string | null;
  review_at: string | null;
  source_doc_id: string | null;
  source_block_id: string | null;
  source_item_id: string | null;
  linked_item_id: string | null;
  linked_item_title: string | null;
  linked_item_status: string | null;
  meeting_minutes: number | null;
  participant_count: number | null;
  outcome: string;
  version: number;
  created_at: string;
  updated_at: string;
};

/** One period's numbers, for an experiment's before and after. */
export type PeriodMeasures = {
  kept_rate: number | null;
  focus_minutes_per_week: number;
  tasks_done_per_week: number;
};

/**
 * An experiment measured: the same stretch of days before it started, and
 * while it ran (to its review date, or today). The numbers come from what
 * was planned, focused on and finished; the verdict is still the person's.
 */
export type ExperimentEvidence = {
  before: PeriodMeasures & { from: string; to: string };
  during: PeriodMeasures & { from: string; to: string };
};
