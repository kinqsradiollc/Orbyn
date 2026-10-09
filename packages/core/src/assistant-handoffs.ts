import { z } from "zod";

/** Hard ceilings; durable storage must enforce them across the entire chain. */
export const ASSISTANT_HANDOFF_LIMITS = {
  depth: 3,
  chainCount: 20,
  deliveryAttempts: 3,
  sources: 20,
} as const;

export const assistantHandoffLane = z.enum(["background", "overnight"]);
export type AssistantHandoffLane = z.output<typeof assistantHandoffLane>;

/** Revisions identify evidence; they never confer access to the referenced object. */
export const assistantHandoffSource = z
  .object({
    kind: z.enum(["job", "task", "routine", "goal", "doc"]),
    id: z.uuid(),
    revision: z.string().trim().min(1).max(128),
  })
  .strict();
export type AssistantHandoffSource = z.output<typeof assistantHandoffSource>;

/** A request cannot choose its owner, producer lane, chain depth or receiving job. */
export const assistantHandoffInput = z
  .object({
    producer_job_id: z.uuid(),
    expected_producer_revision: z.string().trim().min(1).max(128),
    recipient_lane: assistantHandoffLane,
    title: z.string().trim().min(1).max(240),
    instruction: z.string().trim().min(1).max(4000),
  })
  .strict();

/** Server-authored receipt, read only after current source and owner checks. */
export const assistantHandoff = z
  .object({
    id: z.uuid(),
    owner_id: z.uuid(),
    root_id: z.uuid(),
    parent_id: z.uuid().nullable(),
    depth: z.number().int().min(0).max(ASSISTANT_HANDOFF_LIMITS.depth),
    revision: z.number().int().positive(),
    producer_lane: assistantHandoffLane,
    recipient_lane: assistantHandoffLane,
    producer_job_id: z.uuid(),
    recipient_job_id: z.uuid().nullable(),
    recipient_chat_id: z.uuid().nullable(),
    title: z.string().trim().min(1).max(240),
    instruction: z.string().trim().min(1).max(4000),
    sources: z
      .array(assistantHandoffSource)
      .min(1)
      .max(ASSISTANT_HANDOFF_LIMITS.sources),
    status: z.enum([
      "proposed",
      "accepted",
      "completed",
      "failed",
      "cancelled",
    ]),
    delivery_attempts: z
      .number()
      .int()
      .min(0)
      .max(ASSISTANT_HANDOFF_LIMITS.deliveryAttempts),
    result: assistantHandoffSource.nullable(),
    failure: z
      .enum([
        "access",
        "revision",
        "policy",
        "connection",
        "budget",
        "delivery",
        "execution",
      ])
      .nullable(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .strict()
  .superRefine((receipt, ctx) => {
    const invalid = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (receipt.producer_lane === receipt.recipient_lane)
      invalid("recipient_lane", "A handoff requires a different runtime lane.");
    if (receipt.recipient_job_id === receipt.producer_job_id)
      invalid("recipient_job_id", "Receiving work must be a distinct job.");
    if (receipt.parent_id === null) {
      if (receipt.depth !== 0 || receipt.root_id !== receipt.id)
        invalid(
          "root_id",
          "A root receipt starts its own chain at depth zero.",
        );
    } else if (
      receipt.depth === 0 ||
      receipt.parent_id === receipt.id ||
      receipt.root_id === receipt.id
    ) {
      invalid("parent_id", "A child receipt must reference an earlier chain.");
    }
    const keys = receipt.sources.map((source) => `${source.kind}:${source.id}`);
    if (new Set(keys).size !== keys.length)
      invalid("sources", "Each source can appear only once.");
    if (
      !receipt.sources.some(
        (source) =>
          source.kind === "job" && source.id === receipt.producer_job_id,
      )
    )
      invalid("sources", "Evidence must include the producing job's revision.");
    if (Date.parse(receipt.updated_at) < Date.parse(receipt.created_at))
      invalid("updated_at", "A receipt cannot change before it was created.");
    if (receipt.status === "proposed" && receipt.recipient_job_id !== null)
      invalid("recipient_job_id", "Proposed work has no receiving job yet.");
    if (
      (receipt.status === "accepted" || receipt.status === "completed") &&
      receipt.recipient_job_id === null
    )
      invalid("recipient_job_id", "Accepted work requires a receiving job.");
    if (
      (receipt.status === "accepted" || receipt.status === "completed") &&
      receipt.delivery_attempts === 0
    )
      invalid(
        "delivery_attempts",
        "Accepted work requires a delivery attempt.",
      );
    if (receipt.status === "completed") {
      if (
        receipt.result?.kind !== "job" ||
        receipt.result.id !== receipt.recipient_job_id
      )
        invalid(
          "result",
          "Completion must reference the receiving job's revision.",
        );
    } else if (receipt.result !== null) {
      invalid("result", "Only completed work carries a result.");
    }
    if ((receipt.status === "failed") !== (receipt.failure !== null))
      invalid("failure", "A failure reason belongs only to failed work.");
  });
export type AssistantHandoff = z.output<typeof assistantHandoff>;

export const assistantHandoffAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attempt") }).strict(),
  z.object({ kind: z.literal("accept"), recipient_job_id: z.uuid() }).strict(),
  z
    .object({ kind: z.literal("complete"), result: assistantHandoffSource })
    .strict(),
  z
    .object({
      kind: z.literal("fail"),
      reason: assistantHandoff.shape.failure.unwrap(),
    })
    .strict(),
  z.object({ kind: z.literal("cancel") }).strict(),
]);
export type AssistantHandoffAction = z.output<typeof assistantHandoffAction>;

/**
 * Validate a revision-guarded receipt change. The backend must lock the receipt,
 * enforce authorization/budgets and persist both job and receipt transactionally.
 * This function performs no authorization and is not a durable delivery service.
 */
export function advanceAssistantHandoff(
  value: AssistantHandoff,
  expectedRevision: number,
  action: AssistantHandoffAction,
  now: string,
): AssistantHandoff {
  const receipt = assistantHandoff.parse(value);
  action = assistantHandoffAction.parse(action);
  if (receipt.revision !== expectedRevision)
    throw new Error("The handoff changed. Reload before continuing.");
  if (["completed", "failed", "cancelled"].includes(receipt.status))
    throw new Error("This handoff has ended.");
  const next = { ...receipt, revision: receipt.revision + 1, updated_at: now };
  if (Date.parse(now) < Date.parse(receipt.updated_at))
    throw new Error("Handoff timestamps cannot move backwards.");
  switch (action.kind) {
    case "attempt":
      if (
        receipt.status !== "proposed" ||
        receipt.delivery_attempts >= ASSISTANT_HANDOFF_LIMITS.deliveryAttempts
      )
        throw new Error("This handoff cannot attempt delivery again.");
      next.delivery_attempts++;
      break;
    case "accept":
      if (receipt.status !== "proposed" || receipt.delivery_attempts === 0)
        throw new Error("Only attempted proposed work can be accepted.");
      next.status = "accepted";
      next.recipient_job_id = action.recipient_job_id;
      break;
    case "complete":
      if (receipt.status !== "accepted")
        throw new Error("Only accepted work can complete.");
      next.status = "completed";
      next.result = action.result;
      break;
    case "fail":
      next.status = "failed";
      next.failure = action.reason;
      break;
    case "cancel":
      next.status = "cancelled";
      break;
  }
  return assistantHandoff.parse(next);
}
