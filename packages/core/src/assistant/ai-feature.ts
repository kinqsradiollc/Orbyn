import { z } from "zod";

/** Display-only provenance for a completed first-party AI feature call. */
export const aiFeatureProvider = z
  .object({
    source: z.enum(["chatgpt", "default"]),
    model: z.string().min(1).max(200),
    fallback: z.boolean(),
  })
  .strict();
export type AiFeatureProvider = z.output<typeof aiFeatureProvider>;

/** Result of the optional Agenda summary; the calendar rewrite succeeds independently. */
export type AgendaBriefOutcome = {
  status: "completed" | "unavailable" | "failed";
  provider?: AiFeatureProvider;
  message?: string;
};

/** Shared concise rewrite feedback for web, desktop and mobile. */
export function agendaRewriteFeedback(result: {
  brief: boolean;
  briefing?: AgendaBriefOutcome;
}): string {
  if (result.brief) {
    const provider = result.briefing?.provider;
    return provider
      ? `Agenda updated · ${aiFeatureProviderLabel(provider)}`
      : "Agenda updated with an AI summary.";
  }
  return result.briefing?.message
    ? `Calendar updated. ${result.briefing.message}`
    : "Agenda updated from your calendar.";
}

/** A compact label; metadata never grants provider or source authority. */
export function aiFeatureProviderLabel(provider: AiFeatureProvider): string {
  const name =
    provider.source === "chatgpt"
      ? "ChatGPT"
      : provider.fallback
        ? "Orbyn fallback"
        : "Orbyn";
  return `${name} · ${provider.model}`;
}
