import { z } from "zod";

/** Owner/lane-scoped cursors, never global event counts or provider credentials. */
export const assistantActivityCursor = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .refine(
    (value) =>
      /^(0|[1-9]\d{0,18})$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
    "Activity cursor is out of range.",
  );
export const assistantActivityLane = z.enum([
  "interactive",
  "background",
  "overnight",
]);
export type AssistantActivityLane = z.output<typeof assistantActivityLane>;

export const assistantActivityQuery = z
  .object({
    after: assistantActivityCursor.default("0"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const assistantActivityEvent = z
  .object({
    sequence: assistantActivityCursor.refine((value) => value !== "0"),
    job_id: z.uuid().nullable(),
    kind: z.enum([
      "queued",
      "running",
      "waiting",
      "done",
      "failed",
      "progress",
      "outcome",
    ]),
    created_at: z.iso.datetime(),
  })
  .strict();
export type AssistantActivityEvent = z.output<typeof assistantActivityEvent>;

export const assistantActivityPage = z
  .object({
    lane: assistantActivityLane,
    cursor: assistantActivityCursor,
    has_more: z.boolean(),
    last_activity_at: z.iso.datetime().nullable(),
    events: z.array(assistantActivityEvent).max(100),
  })
  .strict()
  .superRefine((page, ctx) => {
    if (!assistantActivityCursor.safeParse(page.cursor).success) return;
    if (page.has_more && page.events.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["events"],
        message: "A continuing page must advance its cursor.",
      });
    let previous = 0n;
    for (const [index, event] of page.events.entries()) {
      if (!assistantActivityCursor.safeParse(event.sequence).success) continue;
      const sequence = BigInt(event.sequence);
      if (sequence <= previous || sequence > BigInt(page.cursor))
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "sequence"],
          message:
            "Activity events must be ordered within the returned cursor.",
        });
      previous = sequence;
    }
  });
export type AssistantActivityPage = z.output<typeof assistantActivityPage>;
