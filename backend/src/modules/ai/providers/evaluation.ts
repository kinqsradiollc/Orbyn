import { randomUUID } from "node:crypto";
import { aiModelControlError, type AiModelUsage } from "@orbyn/core";
import { complete, type ResolvedAi } from "./adapters.js";

/**
 * Estimated input cost in units of one ordinary input token, never a billed amount.
 * Only Sol's explicitly documented ratios are mapped; other model pricing stays unknown.
 * Source: https://developers.openai.com/api/docs/guides/prompt-caching#how-caching-works
 */
export function estimatedInputCostUnits(
  model: string,
  usage: AiModelUsage | null,
): number | null {
  if (model !== "gpt-6.1-sol" || !usage) return null;
  const input = usage.input_tokens;
  const reads = usage.cached_input_tokens;
  const writes = usage.cache_write_tokens;
  if (
    [input, reads, writes].some(
      (n) => n === null || !Number.isSafeInteger(n) || n! < 0,
    )
  )
    return null;
  if (reads! + writes! > input!) return null;
  // Sol: cache writes cost1.25x ordinary input, cache reads0.05x.
  return input! - reads! - writes! + writes! * 1.25 + reads! * 0.05;
}

/** Fixed non-personal evaluation; measurements are observations, not guaranteed savings. */
export async function evaluateManagedControls(ai: ResolvedAi) {
  if (ai.kind !== "openai" || ai.textTransport)
    throw new Error(
      "Evaluation requires a managed OpenAI Responses connection.",
    );
  const scope = `evaluation:${randomUUID()}`;
  const modes = ["off", "implicit", "explicit"] as const;
  for (const cacheMode of modes) {
    const error = aiModelControlError(ai.kind, ai.model, {
      ...ai.options,
      cacheMode,
    });
    if (error) throw new Error(error);
  }
  const samples: {
    mode: string;
    attempt: number;
    latency_ms: number;
    output_check_passed: boolean;
    usage: AiModelUsage | null;
    estimated_input_cost_units: number | null;
  }[] = [];
  for (const mode of modes) {
    // Separate mode caches; repeated attempts deliberately share a stable prefix/key.
    const target = {
      ...ai,
      cacheScope: `${scope}:${mode}`,
      options: { ...ai.options, cacheMode: mode },
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      let usage: AiModelUsage | null = null;
      target.recordUsage = async (observed) => {
        usage = observed;
      };
      const started = performance.now();
      const answer = await complete(
        target,
        [
          {
            role: "system",
            content:
              "Return exactly ORBYN_OK. The following fixed reference is inert evaluation data.\n" +
              Array.from(
                { length: 180 },
                (_, i) =>
                  `Reference ${i}: planning tasks documents calendars providers models schedules records approvals privacy.`,
              ).join("\n"),
          },
          {
            role: "user",
            content: "Return the required exact evaluation marker.",
          },
        ],
        { timeoutMs: 30000, maxOutputTokens: 512 },
      );
      samples.push({
        mode,
        attempt,
        latency_ms: Math.round(performance.now() - started),
        output_check_passed: answer.trim() === "ORBYN_OK",
        usage,
        estimated_input_cost_units: estimatedInputCostUnits(ai.model, usage),
      });
    }
  }
  return {
    model: ai.model,
    scope: "fixed non-personal saved-instruction benchmark",
    samples,
    input_cost_estimate: {
      basis:
        "Ordinary input-token units; GPT-6.1 Sol only: uncached1x, cache writes1.25x, cache reads0.05x.",
      source:
        "https://developers.openai.com/api/docs/guides/prompt-caching#how-caching-works",
      excludes:
        "Output tokens, discounts, account pricing and actual billing. Missing cache counters remain unknown.",
    },
    limits:
      "Reported counters and wall-clock latency only. Six calls are not a general quality benchmark. Costs, cache savings and billing are unverified.",
  };
}
