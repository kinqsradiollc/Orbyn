import { z } from "zod";

const slackId = (prefix: string) =>
  z.string().regex(new RegExp(`^[${prefix}][A-Z0-9]{2,63}$`));
const receipt = z.object({
  ok: z.literal(true),
  channel: slackId("D"),
  ts: z.string().regex(/^\d{1,20}\.\d{1,10}$/),
});
export type SlackSendResult =
  | { state: "sent"; channelId: string; messageTs: string }
  | { state: "limited"; retryAfter: number }
  | { state: "failed" }
  | { state: "unknown" };

/** Read only a bounded Slack JSON response. Never retain or report private upstream text. */
async function slackJson(response: Response) {
  if (!response.body) throw new Error("Unavailable");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) throw new Error("Unavailable");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const body = Buffer.concat(chunks);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
const delay = (response: Response) => {
  const value = response.headers.get("retry-after");
  return value && /^\d{1,6}$/.test(value)
    ? Math.max(5, Math.min(3600, Number(value)))
    : 60;
};
const failure = z.object({ ok: z.literal(false), error: z.string().max(200) });
// These documented refusals explicitly mean that no message was accepted.
const refused = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "missing_scope",
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "restricted_action",
]);

/** Fixed Slack endpoints, bot-only authorization, bounded responses and no transport retry. */
export async function sendSlackDm(
  accessToken: string,
  actor: string,
  message: { text: string; blocks: unknown[] },
  request: typeof fetch = fetch,
): Promise<SlackSendResult> {
  if (
    !accessToken ||
    accessToken.length > 8192 ||
    !slackId("UW").safeParse(actor).success ||
    !message.text ||
    message.text.length > 4000 ||
    Buffer.byteLength(JSON.stringify(message)) > 32768
  )
    return { state: "failed" };
  const post = async (
    method: "conversations.open" | "chat.postMessage",
    body: unknown,
  ) =>
    request(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  try {
    const opened = await post("conversations.open", {
      users: actor,
      return_im: true,
    });
    if (opened.status === 429) {
      await opened.body?.cancel();
      return { state: "limited", retryAfter: delay(opened) };
    }
    if (!opened.ok) {
      await opened.body?.cancel();
      return { state: "failed" };
    }
    const raw = await slackJson(opened);
    const room = z
      .object({ ok: z.literal(true), channel: z.object({ id: slackId("D") }) })
      .safeParse(raw);
    if (!room.success) return { state: "failed" };
    const posted = await post("chat.postMessage", {
      channel: room.data.channel.id,
      ...message,
      mrkdwn: false,
      parse: "none",
      unfurl_links: false,
      unfurl_media: false,
    });
    if (posted.status === 429) {
      await posted.body?.cancel();
      return { state: "limited", retryAfter: delay(posted) };
    }
    if (!posted.ok) {
      await posted.body?.cancel();
      return { state: "unknown" };
    }
    const data = await slackJson(posted);
    const accepted = receipt.safeParse(data);
    if (accepted.success && accepted.data.channel === room.data.channel.id)
      return {
        state: "sent",
        channelId: accepted.data.channel,
        messageTs: accepted.data.ts,
      };
    const declined = failure.safeParse(data);
    return declined.success && refused.has(declined.data.error)
      ? { state: "failed" }
      : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

/** Plain text prevents mentions/markup injection. Approval links always open the complete owned review. */
export function slackAgentMessage(input: {
  event: "done" | "failed" | "waiting" | "overnight";
  title?: string;
  question?: string;
  agentName?: string;
  appUrl: string;
}) {
  const url = new URL(input.appUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("Agent channel website URL is unavailable.");
  url.pathname = "/app";
  const status =
    input.event === "done"
      ? "Background work finished"
      : input.event === "failed"
        ? "Background work needs attention"
        : input.event === "overnight"
          ? "Overnight results are ready"
          : "Background work needs your answer";
  const title = input.title?.trim().slice(0, 200);
  const question = input.question?.trim().slice(0, 1200);
  const heading = input.agentName?.trim()
    ? `${input.agentName.trim().slice(0, 40)} · ${status}`
    : status;
  const text = [heading, title, question, "Open Orbyn to review."]
    .filter(Boolean)
    .join("\n");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "plain_text", text, emoji: false } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `<${url.href}|Open Orbyn>`,
          },
        ],
      },
    ],
  };
}
