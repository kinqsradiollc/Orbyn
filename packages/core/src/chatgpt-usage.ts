import { z } from "zod";
import { chatgptPlanUsage } from "./chatgpt-desktop.js";
import { chatgptModel } from "./chatgpt-models.js";
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,39})$/);
/** Completed requests observed by Orbyn, never account-wide allowance or remaining quota. */
export const chatgptUsageSummary = z
  .object({
    since: z.iso.datetime(),
    until: z.iso.datetime(),
    recording_enabled: z.boolean(),
    completed_requests: z.number().int().nonnegative().safe(),
    measured_requests: z.number().int().nonnegative().safe(),
    input_tokens: decimal,
    output_tokens: decimal,
    total_tokens: decimal,
    recent: z
      .array(
        z
          .object({
            request_id: z.uuid(),
            model: chatgptModel.shape.slug,
            completed_at: z.iso.datetime(),
            usage: chatgptPlanUsage.nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ![value.input_tokens, value.output_tokens, value.total_tokens].every(
        (n) => decimal.safeParse(n).success,
      )
    )
      return;
    if (
      value.measured_requests > value.completed_requests ||
      value.recent.length > value.completed_requests ||
      BigInt(value.total_tokens) !==
        BigInt(value.input_tokens) + BigInt(value.output_tokens)
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid completed-request usage totals.",
      });
  });
export type ChatgptUsageSummary = z.output<typeof chatgptUsageSummary>;
/** Format exact decimal totals without a lossy conversion to Number. */
export function formatChatgptTokens(value: string): string {
  return decimal.parse(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
