import { randomUUID } from "node:crypto";
import { aiModelControlError, type AiModelUsage } from "@orbyn/core";
import { complete, type ResolvedAi } from "./adapters.js";

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
      });
    }
  }
  return {
    model: ai.model,
    scope: "fixed non-personal saved-instruction benchmark",
    samples,
    limits:
      "Reported counters and wall-clock latency only. Six calls are not a general quality benchmark. Costs, cache savings and billing are unverified.",
  };
}
