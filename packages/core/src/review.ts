import { z } from "zod";
import { DOC_KINDS } from "./docs.js";

/**
 * The Review inbox: changes waiting for a person's approval, whether the
 * built-in assistant or an outside agent (over MCP) proposed them. Agents'
 * proposals are made of typed changes across tasks, pages, projects,
 * sessions and links; the assistant's older proposals are read into the
 * same shape for the inbox. Only a person signed in to Orbyn's own apps
 * (web, desktop, phone) approves one, never a key or an agent.
 */

export const PROPOSAL_SOURCES = ["assistant", "agent"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

/** Pending ones past their time read as expired. */
export const PROPOSAL_STATUSES = [
  "pending",
  "applied",
  "declined",
  "cancelled",
  "expired",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** How long a proposal waits: the assistant's a quarter hour, an agent's three days. */
export const PROPOSAL_EXPIRY_MINUTES: Record<ProposalSource, number> = {
  assistant: 15,
  agent: 72 * 60,
};

/** The most changes one proposal holds. */
export const MAX_PROPOSAL_CHANGES = 50;

const id = z.uuid();
const title = z.string().max(300);
const at = z.iso.datetime({ offset: true });
const space = z.uuid().nullable();

/** Fields a proposed task change sets (the item's own field names). */
const taskFields = z.record(z.string().max(40), z.unknown());

/** One proposed change. Each names what it is about by title, for people. */
export const reviewChange = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task.create"),
    title,
    team_id: space,
    /** The new item's fields, as POST /items takes them. */
    data: taskFields,
    /** People an event would invite (they're emailed). */
    emails: z.array(z.string().max(320)).max(100).default([]),
  }),
  z.object({
    type: z.literal("task.update"),
    item_id: id,
    version: z.number().int().positive(),
    title,
    team_id: space,
    /** Only the fields that change, and what they were. */
    patch: taskFields,
    before: taskFields,
    emails: z.array(z.string().max(320)).max(100).default([]),
  }),
  z.object({
    type: z.literal("task.delete"),
    item_id: id,
    version: z.number().int().positive(),
    title,
    team_id: space,
    emails: z.array(z.string().max(320)).max(100).default([]),
  }),
  z.object({
    type: z.literal("task.complete"),
    item_id: id,
    version: z.number().int().positive(),
    title,
    team_id: space,
    done: z.boolean(),
  }),
  z.object({
    type: z.literal("checklist.remove"),
    item_id: id,
    step_id: id,
    title,
    step: z.string().max(500),
    team_id: space,
  }),
  z.object({
    type: z.literal("checklist.edit"),
    item_id: id,
    title,
    team_id: space,
    /** New steps, at the end. */
    add: z.array(z.string().max(500)).max(50).default([]),
    tick: z.array(id).max(100).default([]),
    untick: z.array(id).max(100).default([]),
    rename: z
      .array(z.object({ id, title: z.string().max(500) }))
      .max(100)
      .default([]),
  }),
  z.object({
    type: z.literal("doc.create"),
    title,
    team_id: space,
    kind: z.enum(DOC_KINDS).default("doc"),
    markdown: z.string().max(60_000),
    folder_id: id.nullable().default(null),
    project_id: id.nullable().default(null),
  }),
  z.object({
    type: z.literal("doc.edit"),
    doc_id: id,
    version: z.number().int().positive(),
    title,
    team_id: space,
    /** The whole page after the edit (block ids kept). */
    content: z.array(z.record(z.string(), z.unknown())).max(5000),
    /** The lines that change, before and after, for the diff. */
    lines: z
      .array(
        z.object({
          before: z.string().max(5000).nullable(),
          after: z.string().max(5000).nullable(),
        }),
      )
      .max(200),
    new_title: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("doc.delete"),
    doc_id: id,
    version: z.number().int().positive(),
    title,
    team_id: space,
  }),
  z.object({
    type: z.literal("doc.restore_version"),
    doc_id: id,
    version: z.number().int().positive(),
    to_version: z.number().int().positive(),
    title,
    team_id: space,
  }),
  z.object({
    type: z.literal("project.create"),
    title,
    team_id: space,
    summary: z.string().max(2000).default(""),
    deadline: z.string().max(40).nullable().default(null),
    stages: z
      .array(
        z.object({
          name: z.string().max(120),
          tasks: z.array(z.string().max(200)).max(100).default([]),
        }),
      )
      .max(20),
  }),
  z.object({
    type: z.literal("project.delete"),
    project_id: id,
    title,
    team_id: space,
  }),
  z.object({
    type: z.literal("session.add"),
    item_id: id,
    title,
    start_at: at,
    end_at: at,
  }),
  z.object({
    type: z.literal("session.move"),
    block_id: id,
    item_id: id,
    title,
    from_start_at: at,
    from_end_at: at,
    start_at: at,
    end_at: at,
  }),
  z.object({
    type: z.literal("session.remove"),
    block_id: id,
    item_id: id,
    title,
    from_start_at: at,
    from_end_at: at,
  }),
  z.object({
    type: z.literal("link.remove"),
    kind: z.enum(["depends_on", "doc_task", "project"]),
    from_id: id,
    to_id: id,
    title,
    team_id: space,
  }),
]);
export type ReviewChange = z.output<typeof reviewChange>;
export type ReviewChangeInput = z.input<typeof reviewChange>;
export type ReviewChangeType = ReviewChange["type"];

/** One line of a change's before-and-after. */
export type ReviewRow = {
  label: string;
  before: string | null;
  after: string | null;
};

/** A change as the inbox shows it. */
export type ReviewDiff = {
  index: number;
  type: ReviewChangeType | "assistant.plan";
  /** One line: "New task “Essay outline”". */
  headline: string;
  /** "Personal", or the team's name. */
  space: string;
  rows: ReviewRow[];
  /** People this change emails (event invites). */
  emails: string[];
  /** It changed (or went) since it was proposed; approving it is refused. */
  stale: boolean;
  stale_reason: string | null;
};

/** A proposal in the Review inbox. */
export type ReviewItem = {
  id: string;
  source: ProposalSource;
  /** The app that proposed it ("Claude"), or "Orbyn assistant". */
  proposer: string;
  summary: string;
  status: ProposalStatus;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  changes: ReviewDiff[];
  /** Approving some of the changes (not all) is possible. */
  partial: boolean;
};

/** The inbox: what waits, and what was decided lately. */
export type ReviewInbox = {
  pending: ReviewItem[];
  recent: ReviewItem[];
};

/** Approving: all changes, or only these (by index). */
export const reviewApproveInput = z
  .object({
    only: z.array(z.number().int().min(0).max(99)).max(100).optional(),
    /** Drafted projects: give the tasks the suggested deadlines. */
    give_tasks_deadlines: z.boolean().default(true),
  })
  .strict();
export type ReviewApproveInput = z.input<typeof reviewApproveInput>;

export type ReviewApplied = {
  applied: true;
  /** The indexes of the changes made. */
  changes: number[];
  project_id: string | null;
};

/** What the inbox calls the one who proposed it. */
export const proposerName = (source: ProposalSource, clientName: string) =>
  source === "assistant"
    ? "Orbyn assistant"
    : clientName.trim() || "An outside agent";

/** The path of a proposal in the web app. */
export const reviewPath = (proposalId: string) =>
  `/app/review/${proposalId.toLowerCase()}`;
