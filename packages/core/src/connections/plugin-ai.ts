import { z } from "zod";

/** Credential-free workspace choice shown before the owner consents to plugin AI. */
export const pluginAiProvider = z
  .object({
    id: z.uuid(),
    revision: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    model: z.string().min(1).max(256),
  })
  .strict();

/** Explicit owner CAS, independent of OAuth read/write and personal-plan consent. */
export const pluginAiPermissionInput = z
  .object({
    enabled: z.boolean(),
    expected_version: z.number().int().min(0).max(2147483646),
    provider: pluginAiProvider
      .pick({ id: true, revision: true, model: true })
      .optional(),
    max_output_tokens: z.number().int().min(1).max(2048).optional(),
    daily_call_limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.enabled &&
      (!value.provider || !value.max_output_tokens || !value.daily_call_limit)
    )
      context.addIssue({
        code: "custom",
        message:
          "Review the workspace provider and both limits before enabling AI.",
      });
    if (
      !value.enabled &&
      (value.provider ||
        value.max_output_tokens !== undefined ||
        value.daily_call_limit !== undefined)
    )
      context.addIssue({
        code: "custom",
        message: "Disabling AI does not change or authorize a provider.",
      });
  });

export const pluginAiPermissionView = z
  .object({
    grant_id: z.uuid(),
    enabled: z.boolean(),
    active: z.boolean(),
    version: z.number().int().nonnegative(),
    provider: pluginAiProvider.nullable(),
    available_provider: pluginAiProvider.nullable(),
    max_output_tokens: z.number().int().min(1).max(2048),
    daily_call_limit: z.number().int().min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.enabled && (!value.provider || value.version < 1))
      context.addIssue({
        code: "custom",
        message:
          "Enabled permission must retain a reviewed provider and version.",
      });
    if (
      value.active &&
      (!value.enabled ||
        !value.provider ||
        !value.available_provider ||
        value.provider.id !== value.available_provider.id ||
        value.provider.revision !== value.available_provider.revision ||
        value.provider.model !== value.available_provider.model)
    )
      context.addIssue({
        code: "custom",
        message: "Active permission must match the current workspace provider.",
      });
  });
export type PluginAiPermissionInput = z.input<typeof pluginAiPermissionInput>;
export type PluginAiPermissionView = z.output<typeof pluginAiPermissionView>;
