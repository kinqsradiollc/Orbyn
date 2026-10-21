import { z } from "zod";
import { CapabilityError } from "../../capabilities/registry.js";

/** Host input carries text and a durable operation ID, never provider authority. */
export const pluginInferenceInput = z
  .object({
    operation_id: z
      .uuid()
      .refine((id) => id[14] === "7", "Use a UUIDv7 operation ID."),
    prompt: z
      .string()
      .min(1)
      .max(16000)
      .refine((text) => text.trim().length > 0),
  })
  .strict();

/** Reject expired operation IDs before creating a new receipt, even after retention cleanup. */
export function assertNewPluginOperation(id: string, now = Date.now()) {
  const parsed = pluginInferenceInput.shape.operation_id.parse(id);
  const timestamp = Number.parseInt(
    parsed.slice(0, 8) + parsed.slice(9, 13),
    16,
  );
  if (timestamp > now + 60000 || timestamp < now - 86400000)
    throw new CapabilityError(
      "INVALID",
      "This operation ID expired or is ahead of the server clock. Start a new operation.",
    );
}

/** Captured server-owned permission. Never accept this record from a plugin host. */
export const pluginManagedPermission = z
  .object({
    user_id: z.uuid(),
    grant_id: z.uuid(),
    client_id: z.string().min(1).max(2048),
    version: z.number().int().min(1).max(2147483647),
    enabled: z.boolean(),
    provider_id: z.uuid(),
    provider_revision: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    max_output_tokens: z.number().int().min(1).max(2048),
    daily_call_limit: z.number().int().min(1).max(100),
  })
  .strict();
export type PluginManagedPermission = z.output<typeof pluginManagedPermission>;
