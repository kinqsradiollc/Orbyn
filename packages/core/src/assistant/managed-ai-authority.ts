import { z } from "zod";

const revision = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(32);
/** Credential-free generation identity captured when managed work is queued. */
export const managedAiAuthority = z
  .object({
    version: z.literal(1),
    selection_revision: revision,
    provider: z
      .object({
        id: z.uuid(),
        revision,
        model: z.string().min(1).max(200),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ManagedAiAuthority = z.output<typeof managedAiAuthority>;
