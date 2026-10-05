import { z } from "zod";

/** Explicit permission for scheduled Agenda summaries, independent of digest settings. */
export const agendaPrivatePermissionInput = z
  .object({
    enabled: z.boolean(),
    expected_version: z.number().int().nonnegative(),
    expected_provider_choice_version: z.number().int().nonnegative(),
    expected_preference_version: z.number().int().nonnegative().optional(),
  })
  .strict();

export const agendaPrivatePermission = z
  .object({
    id: z.uuid().nullable(),
    enabled: z.boolean(),
    active: z.boolean(),
    version: z.number().int().nonnegative(),
    model: z.string().nullable(),
  })
  .strict();
export type AgendaPrivatePermission = z.output<typeof agendaPrivatePermission>;
export type AgendaPrivatePermissionInput = z.input<
  typeof agendaPrivatePermissionInput
>;
