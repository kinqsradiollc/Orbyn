import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Refusals never include payload content, credentials or external identifiers. */
export class SlackInteractionError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 409 | 413) {
    super(
      status === 409
        ? "This card changed or was already answered."
        : "This Slack interaction is unavailable.",
    );
    this.name = "SlackInteractionError";
  }
}
const id = (prefix: string) =>
  z.string().regex(new RegExp(`^[${prefix}][A-Z0-9]{2,63}$`));
const stamp = z
  .string()
  .max(32)
  .regex(/^\d{1,20}\.\d{1,10}$/);
const payload = z.object({
  type: z.literal("block_actions"),
  api_app_id: id("A"),
  team: z.object({ id: id("T") }),
  user: z.object({ id: id("UW") }),
  channel: z.object({ id: id("D") }),
  container: z.object({ type: z.literal("message"), message_ts: stamp }),
  actions: z
    .array(
      z.object({
        type: z.literal("button"),
        action_id: z.enum([
          "orbyn.approve",
          "orbyn.decline",
          "orbyn.submit",
          "orbyn.choice.0",
          "orbyn.choice.1",
          "orbyn.choice.2",
          "orbyn.choice.3",
          "orbyn.choice.4",
        ]),
        value: z.uuid(),
        action_ts: stamp,
      }),
    )
    .length(1),
  state: z.object({ values: z.record(z.string(), z.unknown()) }).optional(),
});
export type SlackReply = {
  appId: string;
  workspaceId: string;
  userId: string;
  channelId: string;
  messageTs: string;
  actionTs: string;
  deliveryId: string;
  requestDigest: string;
  action: "approve" | "decline" | "answer" | "choice";
  answer?: string;
  choice?: number;
};

/** Verify raw bytes before decoding, with Slack v0 HMAC and the five-minute window. */
export function readSlackReply(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  expectedAppId: string,
  now = Date.now(),
): SlackReply {
  if (raw.byteLength > 65536) throw new SlackInteractionError(413);
  const timestamp = headers["x-slack-request-timestamp"],
    signature = headers["x-slack-signature"];
  if (
    !secret ||
    typeof timestamp !== "string" ||
    !/^\d{10,12}$/.test(timestamp) ||
    typeof signature !== "string" ||
    !/^v0=[0-9a-f]{64}$/.test(signature)
  )
    throw new SlackInteractionError(401);
  if (Math.abs(now / 1000 - Number(timestamp)) > 300)
    throw new SlackInteractionError(401);
  const actual = Buffer.from(signature.slice(3), "hex");
  const expected = createHmac("sha256", secret)
    .update(`v0:${timestamp}:`)
    .update(raw)
    .digest();
  if (!timingSafeEqual(actual, expected)) throw new SlackInteractionError(401);
  const contentType = headers["content-type"];
  if (
    typeof contentType !== "string" ||
    contentType.split(";")[0].trim().toLowerCase() !==
      "application/x-www-form-urlencoded"
  )
    throw new SlackInteractionError(400);
  let input: z.output<typeof payload>;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const form = new URLSearchParams(text);
    if (
      form.getAll("payload").length !== 1 ||
      [...form.keys()].some((key) => key !== "payload")
    )
      throw new Error();
    input = payload.parse(JSON.parse(form.get("payload")!));
  } catch {
    throw new SlackInteractionError(400);
  }
  if (input.api_app_id !== expectedAppId) throw new SlackInteractionError(403);
  const selected = input.actions[0];
  const reply: SlackReply = {
    appId: input.api_app_id,
    workspaceId: input.team.id,
    userId: input.user.id,
    channelId: input.channel.id,
    messageTs: input.container.message_ts,
    actionTs: selected.action_ts,
    deliveryId: selected.value,
    requestDigest: createHash("sha256").update(raw).digest("hex"),
    action:
      selected.action_id === "orbyn.approve"
        ? "approve"
        : selected.action_id === "orbyn.decline"
          ? "decline"
          : selected.action_id === "orbyn.submit"
            ? "answer"
            : "choice",
  };
  if (reply.action === "choice")
    reply.choice = Number(selected.action_id.slice(-1));
  if (reply.action === "answer") {
    const field = input.state?.values[`orbyn-${reply.deliveryId}`];
    const parsed = z
      .object({
        "orbyn.answer": z.object({
          type: z.literal("plain_text_input"),
          value: z.string().trim().min(1).max(4000),
        }),
      })
      .safeParse(field);
    if (!parsed.success) throw new SlackInteractionError(400);
    reply.answer = parsed.data["orbyn.answer"].value;
  }
  return reply;
}

export type SlackDeliveryBinding = {
  id: string;
  appId: string;
  workspaceId: string;
  userId: string;
  channelId: string;
  messageTs: string;
  waitingId: string;
  kind: "question" | "approval";
  connectionRevision: number;
  expiresAt: Date;
};

/** Bind a signed actor to the exact sent card and current waiting state, never the next prompt. */
export function resolveSlackReply(
  reply: SlackReply,
  delivery: SlackDeliveryBinding,
  current: {
    id: string;
    kind: "question" | "approval";
    choices?: string[];
  } | null,
  connection: { revision: number; revoked: boolean },
  now = Date.now(),
):
  | { waiting_id: string; answer: string }
  | { waiting_id: string; approved: boolean; scope: "once" } {
  if (
    connection.revoked ||
    delivery.expiresAt.getTime() <= now ||
    delivery.connectionRevision !== connection.revision ||
    reply.deliveryId !== delivery.id ||
    reply.appId !== delivery.appId ||
    reply.workspaceId !== delivery.workspaceId ||
    reply.userId !== delivery.userId ||
    reply.channelId !== delivery.channelId ||
    reply.messageTs !== delivery.messageTs
  )
    throw new SlackInteractionError(403);
  if (
    !current ||
    current.id !== delivery.waitingId ||
    current.kind !== delivery.kind
  )
    throw new SlackInteractionError(409);
  if (current.kind === "approval") {
    if (reply.action !== "approve" && reply.action !== "decline")
      throw new SlackInteractionError(400);
    return {
      waiting_id: current.id,
      approved: reply.action === "approve",
      scope: "once",
    };
  }
  const answer =
    reply.action === "answer"
      ? reply.answer
      : reply.action === "choice" && reply.choice !== undefined
        ? current.choices?.[reply.choice]
        : undefined;
  if (!answer || !answer.trim() || answer.length > 4000)
    throw new SlackInteractionError(400);
  return { waiting_id: current.id, answer };
}
