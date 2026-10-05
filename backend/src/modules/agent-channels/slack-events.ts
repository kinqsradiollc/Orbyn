import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SlackInteractionError,
  verifySlackRequest,
} from "./slack-interactions.js";

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^[${prefix}][A-Z0-9]{2,63}$`));
const stamp = z
  .string()
  .max(32)
  .regex(/^\d{1,20}\.\d{1,10}$/);
const envelope = z.object({
  type: z.literal("event_callback"),
  api_app_id: id("A"),
  team_id: id("T"),
  event_id: z.string().regex(/^Ev[A-Za-z0-9]{2,64}$/),
  event: z.record(z.string(), z.unknown()),
});
const message = z.object({
  type: z.literal("message"),
  channel_type: z.literal("im"),
  channel: id("D"),
  user: id("UW"),
  text: z.string().trim().min(1).max(4000),
  ts: stamp,
  thread_ts: stamp,
});

export type SlackThreadReply = {
  appId: string;
  workspaceId: string;
  userId: string;
  channelId: string;
  messageTs: string;
  actionTs: string;
  eventId: string;
  requestDigest: string;
  action: "answer";
  answer: string;
};
export type SlackEvent =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignored" }
  | { kind: "reply"; reply: SlackThreadReply };

/** Authenticate exact JSON bytes before accepting a bounded human DM thread reply.
 * External IDs locate a sent card; they never grant Orbyn ownership by themselves.
 */
export function readSlackEvent(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  expectedAppId: string,
  now = Date.now(),
): SlackEvent {
  verifySlackRequest(raw, headers, secret, now);
  const contentType = headers["content-type"];
  if (
    typeof contentType !== "string" ||
    contentType.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    throw new SlackInteractionError(400);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new SlackInteractionError(400);
  }
  // Slack's initial URL challenge has no app ID. The app-specific signing secret
  // authenticates it; the legacy verification token is never trusted.
  const challenge = z
    .object({
      type: z.literal("url_verification"),
      challenge: z.string().min(1).max(512),
    })
    .safeParse(value);
  if (challenge.success)
    return { kind: "challenge", challenge: challenge.data.challenge };
  const parsed = envelope.safeParse(value);
  if (!parsed.success) throw new SlackInteractionError(400);
  if (parsed.data.api_app_id !== expectedAppId)
    throw new SlackInteractionError(403);
  const input = parsed.data.event;
  // Do not consume bots, edits, deletions, attachments-only messages or other
  // message subtypes, including a human-looking nested edited message.
  if (
    input.type !== "message" ||
    input.channel_type !== "im" ||
    input.subtype !== undefined ||
    input.bot_id !== undefined ||
    input.bot_profile !== undefined ||
    input.thread_ts === undefined
  )
    return { kind: "ignored" };
  const accepted = message.safeParse(input);
  if (!accepted.success) throw new SlackInteractionError(400);
  if (accepted.data.ts === accepted.data.thread_ts) return { kind: "ignored" };
  return {
    kind: "reply",
    reply: {
      appId: parsed.data.api_app_id,
      workspaceId: parsed.data.team_id,
      userId: accepted.data.user,
      channelId: accepted.data.channel,
      messageTs: accepted.data.thread_ts,
      actionTs: accepted.data.ts,
      eventId: parsed.data.event_id,
      requestDigest: createHash("sha256").update(raw).digest("hex"),
      action: "answer",
      answer: accepted.data.text,
    },
  };
}
