import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/** Only a complete question, never an approval, can receive Teams answer controls. */
export const teamsQuestion = z
  .object({
    kind: z.literal("person"),
    id: z.uuid(),
    question: z.string().trim().min(1).max(1200),
    choices: z.array(z.string().trim().min(1).max(1000)).max(5),
  })
  .strict();
export type TeamsQuestion = z.output<typeof teamsQuestion>;

/** Bind every displayed character and choice to this delivery. */
export function teamsQuestionDigest(
  deliveryId: string,
  question: TeamsQuestion,
) {
  return createHash("sha256")
    .update(JSON.stringify({ deliveryId, ...question }))
    .digest("hex");
}
const literal = (text: string) =>
  text.replace(/([\\`*_{}[\]()#+.!>|~-])/g, "\\$1");

/** Build complete, expiring controls. The caller must persist the nonce hash before sending. */
export function teamsQuestionCard(deliveryId: string, candidate: unknown) {
  const parsed = teamsQuestion.safeParse(candidate);
  if (!z.uuid().safeParse(deliveryId).success || !parsed.success) return null;
  const question = parsed.data;
  const cardNonce = randomBytes(32).toString("base64url");
  const questionDigest = teamsQuestionDigest(deliveryId, question);
  const binding = {
    delivery_id: deliveryId,
    waiting_id: question.id,
    question_digest: questionDigest,
    card_nonce: cardNonce,
  };
  const body: unknown[] = [
    { type: "TextBlock", text: literal(question.question), wrap: true },
    ...question.choices.map((choice, index) => ({
      type: "TextBlock",
      text: literal(`${index + 1}. ${choice}`),
      wrap: true,
    })),
    {
      type: "TextBlock",
      text: "Reply within 15 minutes. This answers only this question.",
      wrap: true,
      isSubtle: true,
    },
  ];
  if (!question.choices.length) {
    body.push({ type: "TextBlock", text: "Your answer", wrap: true });
    body.push({
      type: "Input.Text",
      id: "answer",
      isMultiline: true,
      maxLength: 4000,
      placeholder: "Your answer",
    });
  }
  const actions = (
    question.choices.length
      ? question.choices.map((_, choice) => ({
          title: `Option ${choice + 1}`,
          data: { ...binding, choice },
        }))
      : [{ title: "Send answer", data: binding }]
  ).map(({ title, data }) => ({
    type: "Action.Execute",
    verb: "orbyn.answer-question",
    title,
    data,
    associatedInputs: question.choices.length ? "none" : "auto",
    fallback: {
      type: "Action.Submit",
      title,
      data: { ...data, orbyn_action: "orbyn.answer-question" },
      associatedInputs: question.choices.length ? "none" : "auto",
    },
  }));
  const content = {
    type: "AdaptiveCard",
    version: "1.2",
    body: [...body, { type: "ActionSet", actions }],
  };
  // Do not truncate or send controls whose complete question cannot fit.
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > 24000) return null;
  return {
    attachment: {
      contentType: "application/vnd.microsoft.card.adaptive",
      content,
    },
    questionDigest,
    cardNonceHash: createHash("sha256").update(cardNonce).digest("hex"),
  };
}
