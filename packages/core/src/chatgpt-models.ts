import { z } from "zod";

/** Catalog metadata may be synchronized; credentials are never part of it. */
export const chatgptModel = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\s\x00-\x1f\x7f]+$/),
  display_name: z.string().trim().min(1).max(200),
});
export type ChatgptModel = z.output<typeof chatgptModel>;

/** Only entitled, displayable entries are choices; upstream ordering is retained. */
export function parseChatgptModels(value: unknown): ChatgptModel[] {
  const body = z
    .object({ models: z.array(z.unknown()).max(1000) })
    .parse(value);
  const seen = new Set<string>();
  const result: ChatgptModel[] = [];
  for (const entry of body.models) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("visibility" in entry) ||
      entry.visibility !== "list"
    )
      continue;
    const model = chatgptModel.parse(entry);
    if (!seen.has(model.slug)) {
      seen.add(model.slug);
      result.push(model);
    }
  }
  return result;
}

/** A removed default remains explicit; a different model is never chosen silently. */
export function chatgptDefaultStatus(
  models: readonly ChatgptModel[],
  slug: string | null,
):
  | { status: "unselected" }
  | { status: "unavailable"; slug: string }
  | { status: "available"; model: ChatgptModel } {
  if (slug === null) return { status: "unselected" };
  const model = models.find((m) => m.slug === slug);
  return model
    ? { status: "available", model }
    : { status: "unavailable", slug };
}
