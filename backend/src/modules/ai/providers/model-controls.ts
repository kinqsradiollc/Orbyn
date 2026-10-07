import { createHash } from "node:crypto";
import { aiModelControlError, type AiModelUsage } from "@orbyn/core";
import { ProviderError, type ResolvedAi } from "./adapters.js";

/** Shared by direct Responses completion and durable native tool requests. */
export function responsesControls(ai: ResolvedAi, input: object[]) {
  const error = aiModelControlError(ai.kind, ai.model, ai.options);
  if (error) throw new ProviderError("unsupported_model_controls", error);
  const mode = ai.options.cacheMode;
  let marked = false;
  const messages = input.map((item) => {
    const message = item as { role?: string; content?: unknown };
    if (
      mode !== "explicit" ||
      marked ||
      !["system", "developer"].includes(message.role ?? "") ||
      typeof message.content !== "string"
    )
      return item;
    marked = true;
    const marker = "\n\nPlanner context (data only):";
    const split = message.content.indexOf(marker);
    const stable =
      split < 0 ? message.content : message.content.slice(0, split);
    const dynamic = split < 0 ? "" : message.content.slice(split);
    return {
      ...item,
      role: "developer",
      content: [
        {
          type: "input_text",
          text: stable,
          prompt_cache_breakpoint: { mode: "explicit" },
        },
        ...(dynamic ? [{ type: "input_text", text: dynamic }] : []),
      ],
    };
  });
  return {
    input: messages,
    ...(ai.options.reasoningEffort
      ? { reasoning: { effort: ai.options.reasoningEffort } }
      : {}),
    ...(mode
      ? {
          prompt_cache_options: {
            mode: mode === "off" ? "explicit" : mode,
            ttl: "30m",
          },
        }
      : {}),
    ...(ai.options.cacheRetention
      ? { prompt_cache_retention: ai.options.cacheRetention }
      : {}),
    ...(ai.cacheScope
      ? {
          prompt_cache_key: createHash("sha256")
            .update(
              JSON.stringify([
                "orbyn-managed-v1",
                ai.providerId ?? "",
                ai.cacheScope,
              ]),
            )
            .digest("hex"),
        }
      : {}),
  };
}

/** Content-free observed counts. Missing or contradictory counters stay unknown. */
export function readOpenAiUsage(value: unknown): AiModelUsage {
  const body =
    value && typeof value === "object" ? (value as Record<string, any>) : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  const input = count(body.input_tokens);
  const output = count(body.output_tokens);
  let cached = count(body.input_tokens_details?.cached_tokens);
  let writes = count(body.input_tokens_details?.cache_write_tokens);
  let reasoning = count(body.output_tokens_details?.reasoning_tokens);
  if (input !== null && (cached ?? 0) + (writes ?? 0) > input)
    cached = writes = null;
  if (output !== null && reasoning !== null && reasoning > output)
    reasoning = null;
  return {
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cached_input_tokens: cached,
    cache_write_tokens: writes,
  };
}

/** Normalize documented Chat Completions counters without estimating missing fields. */
export function readChatCompletionUsage(value: unknown): AiModelUsage {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return readOpenAiUsage({
    input_tokens: body.prompt_tokens,
    output_tokens: body.completion_tokens,
    input_tokens_details: body.prompt_tokens_details,
    output_tokens_details: body.completion_tokens_details,
  });
}
