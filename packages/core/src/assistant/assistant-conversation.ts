import { z } from "zod";
import { assistantActivityCursor } from "./assistant-activity.js";
import { savedChatTurn } from "../projects/project-chats.js";
import { reminderNudgeSettingsInput } from "./reminder-nudges.js";

/** Wire cursors stay strings: PostgreSQL bigint exceeds JavaScript precision. */
export const assistantConversationSequence = assistantActivityCursor;
const positiveSequence = assistantConversationSequence.refine((s) => s !== "0");

export const assistantConversationSource = z
  .object({
    kind: z.enum([
      "task",
      "doc",
      "project",
      "record",
      "goal",
      "routine",
      "habit",
      "exam",
      "team",
      "calendar",
      "comment",
      "chat",
      "entry",
      "binding",
    ]),
    id: z.uuid(),
  })
  .strict();
export type AssistantConversationSource = z.output<
  typeof assistantConversationSource
>;

export const assistantConversationDestination = z
  .object({
    /** A new ID for each destination lifetime, even if a client reuses a chat ID. */
    id: z.uuid(),
    chat_id: z.uuid(),
    personal: z.boolean(),
    last_sequence: assistantConversationSequence,
    read_sequence: assistantConversationSequence,
  })
  .strict()
  .refine(
    (d) =>
      !assistantConversationSequence.safeParse(d.read_sequence).success ||
      !assistantConversationSequence.safeParse(d.last_sequence).success ||
      BigInt(d.read_sequence) <= BigInt(d.last_sequence),
    {
      message: "Read cursor cannot exceed the conversation.",
    },
  );
export type AssistantConversationDestination = z.output<
  typeof assistantConversationDestination
>;
export const assistantConversationLocation = z
  .object({
    destination: assistantConversationDestination,
    entry_id: z.uuid(),
    sequence: positiveSequence,
  })
  .strict();

/** Explicit read-only access to the legacy execution window; never model context. */
export const assistantSavedHistoryQuery = z
  .object({
    before: z.coerce.number().int().min(0).max(200).optional(),
    version: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict()
  .refine(
    (value) => value.before === undefined || value.version !== undefined,
    { message: "Earlier history needs its snapshot version." },
  );
export const assistantSavedHistory = z
  .object({
    destination_id: z.uuid(),
    chat_id: z.uuid(),
    version: z.string().regex(/^[0-9a-f]{64}$/),
    before: z.number().int().min(1).max(200).nullable(),
    turns: z
      .array(savedChatTurn.pick({ role: true, text: true, turn_id: true }))
      .max(50),
  })
  .strict();
export type AssistantSavedHistory = z.output<typeof assistantSavedHistory>;

export const assistantConversationHome = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false), destination: z.null() }).strict(),
  z
    .object({
      enabled: z.literal(true),
      destination: assistantConversationDestination.nullable(),
    })
    .strict(),
]);

export const assistantConversationWork = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("job"), id: z.uuid() }).strict(),
  z.object({ kind: z.literal("page_run"), id: z.uuid() }).strict(),
  /** Delivery-window identity; not necessarily an execution assistant_nights ID. */
  z.object({ kind: z.literal("night"), id: z.uuid() }).strict(),
]);
export type AssistantConversationWork = z.output<
  typeof assistantConversationWork
>;

export const assistantConversationNightRun = z
  .object({
    work: z.union([
      assistantConversationWork.options[0],
      assistantConversationWork.options[1],
    ]),
    state: z.enum([
      "queued",
      "running",
      "waiting",
      "done",
      "failed",
      "cancelled",
    ]),
    text: z.string().min(1).max(4000),
  })
  .strict();

const entryIdentity = {
  id: z.uuid(),
  sequence: positiveSequence,
  revision: z.number().int().positive(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
};
export const assistantConversationEntry = z.discriminatedUnion("kind", [
  z
    .object({
      ...entryIdentity,
      kind: z.literal("turn"),
      turn_id: z.uuid(),
      turn: savedChatTurn,
      reply_to_entry_id: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      ...entryIdentity,
      kind: z.literal("update"),
      lane: z.enum(["background", "overnight"]),
      work: assistantConversationWork,
      event: z.enum(["result", "question", "failure", "morning_summary"]),
      text: z.string().min(1).max(12000),
      completed_at: z.iso.datetime().nullable(),
      /** Navigation identity only; applying a change still uses existing Review. */
      execution_chat_id: z.uuid().nullable(),
      waiting_id: z.uuid().nullable(),
      /** Current exact waiting state; absent on older servers and non-questions. */
      waiting_kind: z.enum(["person", "approval"]).nullable().optional(),
      actionable: z.boolean().optional(),
      sources: z.array(assistantConversationSource).max(500),
      /** Bounded result excerpts; remaining work is available in Overnight activity. */
      night_runs: z.array(assistantConversationNightRun).max(50).optional(),
    })
    .strict(),
]);
export type AssistantConversationEntry = z.output<
  typeof assistantConversationEntry
>;

/** Fresh projection only: source titles never become persisted authority. */
export const assistantConversationDetails = z
  .object({
    destination_id: z.uuid(),
    entry: assistantConversationEntry,
    sources: z
      .array(
        z
          .object({
            kind: z.enum(["doc", "task", "project"]),
            id: z.uuid(),
            title: z.string().max(1000),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
export type AssistantConversationDetails = z.output<
  typeof assistantConversationDetails
>;

export const assistantConversationQuery = z
  .object({
    after: assistantConversationSequence.default("0"),
    through: assistantConversationSequence.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    (q) =>
      !q.through ||
      !assistantConversationSequence.safeParse(q.through).success ||
      !assistantConversationSequence.safeParse(q.after).success ||
      BigInt(q.after) <= BigInt(q.through),
    { message: "Cursor range is invalid." },
  );
export const assistantConversationPage = z
  .object({
    destination: assistantConversationDestination,
    cursor: assistantConversationSequence,
    has_more: z.boolean(),
    entries: z.array(assistantConversationEntry).max(100),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (
      !assistantConversationSequence.safeParse(page.cursor).success ||
      !assistantConversationSequence.safeParse(page.destination.last_sequence)
        .success
    )
      return;
    let previous = 0n;
    for (const [index, entry] of page.entries.entries()) {
      if (!positiveSequence.safeParse(entry.sequence).success) continue;
      const sequence = BigInt(entry.sequence);
      if (sequence <= previous || sequence > BigInt(page.cursor))
        ctx.addIssue({
          code: "custom",
          path: ["entries", index, "sequence"],
          message: "Entries must be ordered within the page cursor.",
        });
      previous = sequence;
    }
    if (page.has_more && !page.entries.length)
      ctx.addIssue({
        code: "custom",
        path: ["entries"],
        message: "A continuing page must advance its cursor.",
      });
    if (BigInt(page.cursor) > BigInt(page.destination.last_sequence))
      ctx.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "Page cursor exceeds the conversation.",
      });
  });
export type AssistantConversationPage = z.output<
  typeof assistantConversationPage
>;

export const assistantConversationReadInput = z
  .object({
    /** Acknowledge only entries actually displayed in the active conversation. */
    through: positiveSequence,
  })
  .strict();

export const assistantConversationReplyInput = z
  .object({
    reply_to_entry_id: z.uuid(),
  })
  .strict();

export const assistantConversationAnswerInput = z
  .object({ answer: z.string().trim().min(1).max(4000), turn_id: z.uuid() })
  .strict();
export const assistantConversationAnswer = z
  .object({
    accepted: z.literal(true),
    job_id: z.uuid(),
    turn_id: z.uuid(),
    entry_id: z.uuid(),
    destination_id: z.uuid(),
    reply_to_entry_id: z.uuid(),
  })
  .strict();

export const assistantDeliveryState = z.enum([
  "pending",
  "deferred",
  "published",
  "suppressed",
  "blocked",
]);
export type AssistantDeliveryState = z.output<typeof assistantDeliveryState>;

export const assistantConversationPreferences = z
  .object({
    muted: z.boolean(),
    quiet_start: reminderNudgeSettingsInput.shape.quiet_start,
    quiet_end: reminderNudgeSettingsInput.shape.quiet_end,
    timezone: z.string().min(1).max(100),
  })
  .strict();
export const assistantConversationMuteInput = z
  .object({ muted: z.boolean() })
  .strict();

export const assistantWorkControls = z
  .object({
    background_paused: z.boolean(),
    overnight_paused: z.boolean(),
  })
  .strict();
export type AssistantWorkControls = z.output<typeof assistantWorkControls>;
export const assistantWorkControlsInput = assistantWorkControls
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose a work control to update.",
  });
