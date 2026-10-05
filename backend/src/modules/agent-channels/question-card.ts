import { createHash } from "node:crypto";
import { z } from "zod";
/** Only a complete bounded question can acquire channel reply authority. */
export const slackQuestion = z.object({
  kind: z.literal("person"),
  id: z.uuid(),
  question: z.string().trim().min(1).max(1200),
  choices: z.array(z.string().trim().min(1).max(1000)).max(5),
});
export type SlackQuestion = z.output<typeof slackQuestion>;
/** Bind displayed question and every choice, not merely the reusable job ID. */
export const slackQuestionDigest = (
  deliveryId: string,
  question: SlackQuestion,
) =>
  createHash("sha256")
    .update(JSON.stringify({ deliveryId, ...question }))
    .digest("hex");
/** Augment an owned message with one-use, explicitly expiring question controls. */
export function slackQuestionCard(
  message: { text: string; blocks: unknown[] },
  deliveryId: string,
  question: SlackQuestion,
  allowThreadReplies = false,
) {
  const parsed = slackQuestion.safeParse(question);
  if (!z.uuid().safeParse(deliveryId).success || !parsed.success) return null;
  if (!question.choices.length && !allowThreadReplies) return null;
  question = parsed.data;
  const choices = question.choices
    .map((choice, i) => `${i + 1}. ${choice}`)
    .join("\n");
  const text = [
    message.text,
    message.text.includes(question.question) ? "" : question.question,
    choices,
    allowThreadReplies
      ? "Choose an option or reply in this message’s thread within 15 minutes."
      : "Choose an option within 15 minutes.",
    "This answers only this question.",
  ]
    .filter(Boolean)
    .join("\n");
  // Never truncate a choice or mint controls for content that cannot be shown.
  if (text.length > 3000) return null;
  const actions = question.choices.map((choice, i) => ({
    type: "button",
    action_id: `orbyn.choice.${i}`,
    value: deliveryId,
    text: {
      type: "plain_text",
      text: choice.length <= 75 ? choice : `Option ${i + 1}`,
      emoji: false,
    },
  }));
  const blocks: unknown[] = [
    { type: "section", text: { type: "plain_text", text, emoji: false } },
    ...message.blocks.slice(1),
  ];
  if (actions.length) blocks.push({ type: "actions", elements: actions });
  if (Buffer.byteLength(JSON.stringify({ text, blocks })) > 32768) return null;
  return { text, blocks };
}
