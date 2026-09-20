import { fail } from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { decryptSecret } from "../../lib/secrets.js";

export type ChatKind = "slack" | "discord";

/** Only real Slack/Discord webhook hosts are accepted (also stops SSRF). */
const HOSTS: Record<ChatKind, RegExp> = {
  slack: /^hooks\.slack\.com$/i,
  discord: /^(canary\.|ptb\.)?discord(app)?\.com$/i,
};

/** Check a webhook URL is https and points at the right service. */
export function assertChatUrl(kind: ChatKind, url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    fail(422, "That doesn't look like a URL.");
  }
  if (u.protocol !== "https:") fail(422, "The webhook URL must be https.");
  if (!HOSTS[kind].test(u.hostname))
    fail(
      422,
      kind === "slack"
        ? "That isn't a Slack webhook (hooks.slack.com)."
        : "That isn't a Discord webhook (discord.com).",
    );
}

/** The signed-in user's chat webhook, decrypted, or null when off. */
export async function chatFor(
  userId: string,
): Promise<{ kind: ChatKind; url: string } | null> {
  const row = (
    await pool.query<{
      chat_webhook_encrypted: string | null;
      chat_webhook_kind: ChatKind | null;
    }>(
      "SELECT chat_webhook_encrypted, chat_webhook_kind FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  if (!row?.chat_webhook_encrypted || !row.chat_webhook_kind) return null;
  return {
    kind: row.chat_webhook_kind,
    url: await decryptSecret(row.chat_webhook_encrypted),
  };
}

/** Post a plain message to a chat webhook. Best-effort, with a short timeout. */
export async function postChat(
  kind: ChatKind,
  url: string,
  text: string,
): Promise<boolean> {
  const body = kind === "slack" ? { text } : { content: text.slice(0, 1900) };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
