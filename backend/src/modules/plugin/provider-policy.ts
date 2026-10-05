import { z } from "zod";
import { AI_PROVIDERS, type AiProviderKind } from "@orbyn/core";
import type { Principal } from "../../capabilities/policy.js";
import { CapabilityError } from "../../capabilities/registry.js";
import {
  complete,
  type ChatMessage,
  type ResolvedAi,
} from "../ai/providers/adapters.js";

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

const refused = () =>
  new CapabilityError(
    "FORBIDDEN",
    "Workspace AI is not permitted for this plugin connection.",
  );

/** Match fresh plugin permission to one exact database provider; exclude plan hooks. */
export function assertPluginManagedProvider(
  principal: Principal,
  permission: PluginManagedPermission,
  ai: ResolvedAi | null,
): asserts ai is ResolvedAi {
  const parsed = pluginManagedPermission.safeParse(permission);
  if (
    !parsed.success ||
    !permission.enabled ||
    principal.via !== "plugin" ||
    principal.user.id !== permission.user_id ||
    principal.grant_id !== permission.grant_id ||
    principal.client.id !== permission.client_id ||
    !ai ||
    ai.source !== "database" ||
    ai.providerId !== permission.provider_id ||
    ai.providerRevision !== permission.provider_revision ||
    ai.model !== permission.model ||
    ai.textTransport ||
    ai.assertAuthority ||
    ai.recordCompletion ||
    ai.operationId
  )
    throw refused();
  if (!Object.hasOwn(AI_PROVIDERS, ai.kind)) throw refused();
  const definition = AI_PROVIDERS[ai.kind as AiProviderKind];
  if (ai.format !== definition.format) throw refused();
}

/**
 * Transport for a broker-owned, durably dispatched operation. The broker must
 * reserve its daily allowance and prevent duplicate/unknown-outcome replay.
 * This function deliberately has no first-party resolver or fallback path.
 */
export async function callPluginManagedProvider(
  principal: Principal,
  permission: PluginManagedPermission,
  ai: ResolvedAi | null,
  input: z.output<typeof pluginInferenceInput>,
  assertFresh: () => Promise<void>,
  options: { signal?: AbortSignal; send?: typeof complete } = {},
) {
  const request = pluginInferenceInput.parse(input);
  assertNewPluginOperation(request.operation_id);
  const captured = Object.freeze(pluginManagedPermission.parse(permission));
  assertPluginManagedProvider(principal, captured, ai);
  const provider = { ...ai, options: { ...ai.options } };
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000);
  await assertFresh();
  signal.throwIfAborted();
  assertPluginManagedProvider(principal, captured, provider);
  const messages: ChatMessage[] = [{ role: "user", content: request.prompt }];
  let text: string;
  try {
    text = await (options.send ?? complete)(provider, messages, {
      signal,
      maxOutputTokens: captured.max_output_tokens,
    });
  } catch {
    // Provider messages may echo host input or upstream account details.
    throw new CapabilityError(
      "INVALID",
      "The workspace AI request did not complete. Its outcome must be reviewed before retrying.",
    );
  }
  signal.throwIfAborted();
  await assertFresh();
  if (
    typeof text !== "string" ||
    !text.trim() ||
    Buffer.byteLength(text, "utf8") > 65536
  )
    throw new CapabilityError(
      "INVALID",
      "The workspace AI response was empty or exceeded its result limit.",
    );
  return {
    operation_id: request.operation_id,
    text,
    provider_id: captured.provider_id,
    model: captured.model,
    permission_version: captured.version,
  };
}
