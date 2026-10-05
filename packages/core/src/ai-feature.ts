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
