import { z } from "zod";
import {
  slackInstallation,
  SLACK_BOT_SCOPES,
  validateSlackOAuthConfig,
  type SlackInstallation,
  type SlackOAuthConfig,
} from "./slack-oauth.js";
import { slackJson, slackRetryAfter } from "./slack-response.js";
export type SlackRefreshResult =
  | { state: "ready"; installation: SlackInstallation }
  | { state: "limited"; retryAfter: number }
  | { state: "reconnect" | "unknown" };
const responseSchema = z.object({
  ok: z.literal(true),
  token_type: z.literal("bot"),
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(8192),
  expires_in: z.number().int().min(60).max(86400),
  scope: z.string().max(4096),
  app_id: z.string().optional(),
  bot_user_id: z.string().optional(),
  team: z.object({ id: z.string() }).optional(),
  authed_user: z.object({ id: z.string() }).optional(),
  is_enterprise_install: z.literal(false).optional(),
});
const refused = new Set([
  "invalid_refresh_token",
  "invalid_auth",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "invalid_client_id",
  "bad_client_secret",
  "missing_scope",
]);
/** One refresh-token redemption; retain the verified mapping and require review for scope/identity drift. */
export async function refreshSlackToken(
  config: SlackOAuthConfig,
  previous: SlackInstallation,
  request: typeof fetch = fetch,
  now = new Date(),
): Promise<SlackRefreshResult> {
  try {
    const current = validateSlackOAuthConfig(config);
    if (
      !slackInstallation.safeParse(previous).success ||
      previous.appId !== current.appId ||
      !previous.refreshToken ||
      SLACK_BOT_SCOPES.some((scope) => !previous.scopes.includes(scope)) ||
      !Number.isFinite(now.getTime())
    )
      return { state: "reconnect" };
    const response = await request("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: current.clientId,
        client_secret: current.clientSecret,
        grant_type: "refresh_token",
        refresh_token: previous.refreshToken,
      }),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      return { state: "limited", retryAfter: slackRetryAfter(response) };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { state: "unknown" };
    }
    const raw = await slackJson(response);
    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      const failure = z
        .object({ ok: z.literal(false), error: z.string().max(200) })
        .safeParse(raw);
      return {
        state:
          failure.success && refused.has(failure.data.error)
            ? "reconnect"
            : "unknown",
      };
    }
    const value = parsed.data;
    const scopes = [
      ...new Set(
        value.scope
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (
      (value.app_id !== undefined && value.app_id !== previous.appId) ||
      (value.bot_user_id !== undefined &&
        value.bot_user_id !== previous.botUserId) ||
      (value.team !== undefined && value.team.id !== previous.workspaceId) ||
      (value.authed_user !== undefined &&
        value.authed_user.id !== previous.userId) ||
      JSON.stringify([...scopes].sort()) !==
        JSON.stringify([...previous.scopes].sort()) ||
      value.refresh_token === previous.refreshToken ||
      value.access_token === previous.accessToken
    )
      return { state: "unknown" };
    const next = slackInstallation.safeParse({
      ...previous,
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: new Date(
        now.getTime() + value.expires_in * 1000,
      ).toISOString(),
    });
    return next.success
      ? { state: "ready", installation: next.data }
      : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}
