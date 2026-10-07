import { z } from "zod";

export const AI_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const AI_CACHE_MODES = ["implicit", "explicit", "off"] as const;
/** Saved connection defaults; absent controls retain the provider's behavior. */
export const aiProviderOptions = z
  .object({
    apiVersion: z.string().trim().max(40).optional(),
    reasoningEffort: z.enum(AI_REASONING_EFFORTS).optional(),
    cacheMode: z.enum(AI_CACHE_MODES).optional(),
    cacheRetention: z.enum(["in_memory", "24h"]).optional(),
  })
  .strict();
export type AiProviderOptions = z.output<typeof aiProviderOptions>;

const standard = ["low", "medium", "high", "xhigh", "max"] as const;
const modern: Record<string, readonly string[]> = {
  "gpt-6.1-sol": standard,
  "gpt-6-astra": standard,
  "gpt-6-sol": ["none", ...standard],
  "gpt-6-luna": ["none", ...standard],
  "gpt-5.6-sol": ["none", ...standard],
  "gpt-5.6": ["none", ...standard],
  "gpt-5.6-terra": ["none", ...standard],
  "gpt-5.6-luna": ["none", ...standard],
};
export const AI_DOCUMENTED_OPENAI_MODELS = Object.keys(modern);

const extendedOnly = new Set(["gpt-5.5", "gpt-5.5-pro"]);
const legacyRetention = new Set([
  "gpt-5.4",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-chat-latest",
  "gpt-5",
  "gpt-5-codex",
  "gpt-4.1",
]);

/** Documented controls only; a model catalog is not evidence of these capabilities. */
export function aiModelCapabilities(kind: string, model: string) {
  if (kind !== "openai")
    return {
      efforts: [] as readonly string[],
      cacheModes: [] as readonly string[],
      retentions: [] as readonly string[],
    };
  if (Object.hasOwn(modern, model))
    return {
      efforts: modern[model],
      cacheModes: AI_CACHE_MODES,
      retentions: [] as readonly string[],
    };
  return {
    efforts: [] as readonly string[],
    cacheModes: [] as readonly string[],
    retentions: extendedOnly.has(model)
      ? ["24h"]
      : legacyRetention.has(model)
        ? ["in_memory", "24h"]
        : [],
  };
}

/** Validate saved defaults against the exact selected model before any dispatch. */
export function aiModelControlError(
  kind: string,
  model: string | undefined,
  options: AiProviderOptions,
): string | null {
  const configured =
    options.reasoningEffort !== undefined ||
    options.cacheMode !== undefined ||
    options.cacheRetention !== undefined;
  if (!configured) return null;
  if (kind !== "openai")
    return "These model controls require a supported OpenAI connection.";
  if (model === undefined) return null; // A newly saved connection is not a model selection.
  const caps = aiModelCapabilities(kind, model);
  if (
    options.reasoningEffort !== undefined &&
    !caps.efforts.includes(options.reasoningEffort)
  )
    return "The selected model does not support this reasoning effort. Choose its default or a supported value.";
  if (
    options.cacheMode !== undefined &&
    !caps.cacheModes.includes(options.cacheMode)
  )
    return "The selected model does not support this cache mode. Clear it before choosing this model.";
  if (
    options.cacheRetention !== undefined &&
    !caps.retentions.includes(options.cacheRetention)
  )
    return "The selected model does not support this cache retention. Clear it before choosing this model.";
  return null;
}

/** Observed provider counters; null means unavailable, never zero usage. */
export type AiModelUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cached_input_tokens: number | null;
  cache_write_tokens: number | null;
};

/** Both clients preserve connection options while replacing only model controls. */
export function editedAiModelOptions(
  current: AiProviderOptions,
  effort: string,
  mode: string,
  retention: string,
): AiProviderOptions {
  const {
    reasoningEffort: _effort,
    cacheMode: _mode,
    cacheRetention: _retention,
    ...connection
  } = current;
  return aiProviderOptions.parse({
    ...connection,
    ...(effort ? { reasoningEffort: effort } : {}),
    ...(mode ? { cacheMode: mode } : {}),
    ...(retention ? { cacheRetention: retention } : {}),
  });
}

/** Compact observed counters; cached/reasoning counters are subsets, not extras. */
export function aiUsageSummary(usage: AiModelUsage): string {
  const parts: string[] = [];
  if (usage.input_tokens !== null) parts.push(`${usage.input_tokens} input`);
  if (usage.output_tokens !== null) parts.push(`${usage.output_tokens} output`);
  if (usage.cached_input_tokens !== null)
    parts.push(`${usage.cached_input_tokens} cached input`);
  if (usage.cache_write_tokens !== null)
    parts.push(`${usage.cache_write_tokens} cache write`);
  if (usage.reasoning_tokens !== null)
    parts.push(`${usage.reasoning_tokens} reasoning`);
  return parts.length
    ? `Tokens: ${parts.join(" · ")}`
    : "Token usage unavailable";
}

export type ManagedAiUsageSummary = {
  window_days: number;
  enabled: boolean;
  requests: number;
  usage: AiModelUsage;
};
