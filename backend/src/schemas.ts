import { z } from "zod";
export const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(128),
  name: z.string().trim().min(1).max(80).default("My space"),
});
export const itemData = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).default(""),
    kind: z.enum(["task", "event"]).default("task"),
    status: z.enum(["todo", "done"]).default("todo"),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    due_at: z.iso.datetime({ offset: true }).nullable().default(null),
    end_at: z.iso.datetime({ offset: true }).nullable().default(null),
    reminder_minutes: z.number().int().min(0).max(10080).default(30),
  })
  .strict()
  .refine(
    (d) =>
      !d.end_at || (!!d.due_at && Date.parse(d.end_at) > Date.parse(d.due_at)),
    "End must be after start",
  )
  .refine(
    (d) => d.kind !== "event" || !!d.due_at,
    "Events require a start time",
  );
export const actionSchema = z
  .object({
    operation: z.enum(["create", "update", "delete"]),
    item_id: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    data: itemData.optional(),
  })
  .strict()
  .refine(
    (a) => a.operation === "create" || (!!a.item_id && !!a.version),
    "Existing item and version required",
  )
  .refine((a) => a.operation === "delete" || !!a.data, "Item data required");
export const agentReply = z.object({
  summary: z.string().max(12000),
  actions: z.array(actionSchema).max(20).default([]),
});
export type Action = z.infer<typeof actionSchema>;
export const deviceData = z.object({
  token: z
    .string()
    .max(250)
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
});
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
