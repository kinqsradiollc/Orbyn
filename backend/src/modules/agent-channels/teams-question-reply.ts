import { createHash } from "node:crypto";
import { z } from "zod";
import {
  authenticateTeamsActivity,
  type TeamsSigningKey,
} from "./teams-auth.js";

/** This authenticates and normalizes a card submission; it never authorizes an answer. */
export class TeamsQuestionReplyError extends Error {
  constructor(readonly status: 400 | 403) {
    super("This Teams question reply is unavailable.");
    this.name = "TeamsQuestionReplyError";
  }
}
const data = z
  .object({
    delivery_id: z.uuid(),
    waiting_id: z.uuid(),
    question_digest: z.string().regex(/^[a-f0-9]{64}$/),
    card_nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    choice: z.number().int().min(0).max(4).optional(),
    answer: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()
  .refine(
    (value) => (value.choice !== undefined) !== (value.answer !== undefined),
  );
const personal = z.object({
  id: z.string().min(1).max(500),
  timestamp: z.iso.datetime({ offset: true }),
  channelId: z.literal("msteams"),
  serviceUrl: z.url().max(2048),
  from: z.object({
    id: z.string().regex(/^29:.{1,997}$/),
    aadObjectId: z.uuid(),
  }),
  recipient: z.object({ id: z.string().min(1).max(200) }),
  conversation: z.object({
    id: z.string().min(1).max(1000),
    conversationType: z.literal("personal"),
    tenantId: z.uuid().optional(),
  }),
  channelData: z.object({ tenant: z.object({ id: z.uuid() }) }),
});
const invoke = personal.extend({
  type: z.literal("invoke"),
  name: z.literal("adaptiveCard/action"),
  value: z.object({
    trigger: z.literal("manual"),
    action: z.object({
      type: z.literal("Action.Execute"),
      verb: z.literal("orbyn.answer-question"),
      id: z.string().max(200).optional(),
      data,
    }),
  }),
});
const submit = personal.extend({
  type: z.literal("message"),
  value: data.safeExtend({ orbyn_action: z.literal("orbyn.answer-question") }),
});

export type TeamsQuestionReply = {
  appId: string;
  tenantId: string;
  objectId: string;
  externalUserId: string;
  conversationId: string;
  serviceUrl: string;
  eventId: string;
  deliveryId: string;
  waitingId: string;
  questionDigest: string;
  cardNonce: string;
  choice?: number;
  answer?: string;
  requestDigest: string;
};
/** Authenticate raw Connector bytes before reading input. Automatic refresh is never a user answer. */
export async function readTeamsQuestionReply(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  config: { appId: string },
  keys?: (refresh?: boolean) => Promise<TeamsSigningKey[]>,
  now = Date.now(),
): Promise<TeamsQuestionReply | null> {
  const activity = await authenticateTeamsActivity(raw, headers, config, keys);
  const fallback =
    activity.type === "message" &&
    (activity.value as { orbyn_action?: unknown } | undefined)?.orbyn_action ===
      "orbyn.answer-question";
  if (
    !fallback &&
    (activity.type !== "invoke" || activity.name !== "adaptiveCard/action")
  )
    return null;
  const value = activity.value as
    { trigger?: unknown; action?: { verb?: unknown } } | undefined;
  if (
    !fallback &&
    (value?.trigger === "automatic" ||
      value?.action?.verb !== "orbyn.answer-question")
  )
    return null;
  const parsed = fallback
    ? submit.safeParse(activity)
    : invoke.safeParse(activity);
  if (!parsed.success) throw new TeamsQuestionReplyError(400);
  const input = parsed.data,
    tenantId = input.channelData.tenant.id;
  if (input.conversation.tenantId && input.conversation.tenantId !== tenantId)
    throw new TeamsQuestionReplyError(403);
  const stamp = Date.parse(input.timestamp);
  if (stamp > now + 300000 || stamp < now - 900000)
    throw new TeamsQuestionReplyError(400);
  const submitted = fallback
    ? (input as z.output<typeof submit>).value
    : (input as z.output<typeof invoke>).value.action.data;
  const reply = {
    appId: config.appId,
    tenantId,
    objectId: input.from.aadObjectId,
    externalUserId: input.from.id,
    conversationId: input.conversation.id,
    serviceUrl: input.serviceUrl,
    eventId: input.id,
    deliveryId: submitted.delivery_id,
    waitingId: submitted.waiting_id,
    questionDigest: submitted.question_digest,
    cardNonce: submitted.card_nonce,
    ...(submitted.choice !== undefined
      ? { choice: submitted.choice }
      : { answer: submitted.answer! }),
  };
  return {
    ...reply,
    requestDigest: createHash("sha256")
      .update(JSON.stringify(reply))
      .digest("hex"),
  };
}
/** Provider invoke acknowledgement means captured, never applied or approved. Always return HTTP200. */
export function teamsQuestionInvokeAck(accepted: boolean) {
  return accepted
    ? {
        statusCode: 200,
        type: "application/vnd.microsoft.activity.message",
        value:
          "Reply received. Orbyn will verify this question before continuing.",
      }
    : {
        statusCode: 400,
        type: "application/vnd.microsoft.error",
        value: {
          code: "BadRequest",
          message:
            "This question changed or is unavailable. Open Orbyn to review it.",
        },
      };
}
