import { z } from "zod";
/** Selecting fallback is an explicit billing/data-routing choice, never an MCP permission. */
export const aiProviderChoiceInput = z.discriminatedUnion("primary", [
  z
    .object({
      primary: z.literal("default"),
      fallback_to_default: z.literal(false),
      expected_version: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      primary: z.literal("chatgpt"),
      connection_id: z.uuid(),
      executor_id: z.uuid(),
      fallback_to_default: z.boolean(),
      expected_version: z.number().int().nonnegative(),
    })
    .strict(),
]);
export const aiProviderChoice = z
  .object({
    primary: z.enum(["default", "chatgpt"]),
    connection_id: z.uuid().nullable(),
    executor_id: z.uuid().nullable(),
    fallback_to_default: z.boolean(),
    version: z.number().int().nonnegative(),
  })
  .strict()
  .refine((v) =>
    v.primary === "chatgpt"
      ? true
      : !v.connection_id && !v.executor_id && !v.fallback_to_default,
  );
export type AiProviderChoice = z.output<typeof aiProviderChoice>;
