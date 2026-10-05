import { createHash, randomBytes } from "node:crypto";
import { fail } from "@orbyn/core";
import { z } from "zod";

export const SLACK_BOT_SCOPES = ["chat:write", "im:write"] as const;
const identity = (prefix: string) =>
  z.string().regex(new RegExp(`^[${prefix}][A-Z0-9]{2,63}$`));
const secret = z.string().min(1).max(8192);
const responseSchema = z.object({
  ok: z.literal(true),
  app_id: identity("A"),
  token_type: z.literal("bot"),
  access_token: secret,
  bot_user_id: identity("UW"),
  scope: z.string().max(4096),
  authed_user: z.object({ id: identity("UW") }),
  team: z.object({ id: identity("T"), name: z.string().min(1).max(200) }),
  is_enterprise_install: z.literal(false),
  refresh_token: secret.optional(),
  expires_in: z.number().int().min(60).max(86400).optional(),
});
export type SlackOAuthConfig = {
  clientId: string;
  clientSecret: string;
  appId: string;
  redirectUri: string;
};
export const slackInstallation = z
  .object({
    appId: identity("A"),
    workspaceId: identity("T"),
    workspaceName: z.string().min(1).max(200),
    userId: identity("UW"),
    botUserId: identity("UW"),
    accessToken: secret,
    refreshToken: secret.optional(),
    expiresAt: z.iso.datetime().nullable(),
    scopes: z.array(z.string().min(1).max(100)).max(100),
  })
  .strict()
  .refine((value) => !!value.refreshToken === !!value.expiresAt);
export type SlackInstallation = z.output<typeof slackInstallation>;

/** Use one administrator-configured HTTPS callback, never request-origin metadata. */
export function validateSlackOAuthConfig(value: SlackOAuthConfig) {
  const parsed = z
    .object({
      clientId: z.string().regex(/^\d{1,32}\.\d{1,32}$/),
      clientSecret: z.string().min(16).max(512),
      appId: identity("A"),
      redirectUri: z.url().max(2048),
    })
    .safeParse(value);
  if (!parsed.success) fail(503, "Slack connection is not configured.");
  const uri = new URL(parsed.data.redirectUri);
  if (
    uri.protocol !== "https:" ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash ||
    ![
      "/agent-channels/slack/callback",
      "/api/agent-channels/slack/callback",
    ].includes(uri.pathname)
  )
    fail(503, "Slack connection is not configured.");
  return { ...parsed.data, redirectUri: uri.href };
}

/** A pending installation becomes unavailable when its app/configuration changes. */
export function slackOAuthConfigDigest(config: SlackOAuthConfig) {
  const current = validateSlackOAuthConfig(config);
  return createHash("sha256")
    .update(
      JSON.stringify([
        current.clientId,
        current.clientSecret,
        current.appId,
        current.redirectUri,
        SLACK_BOT_SCOPES,
      ]),
    )
    .digest("hex");
}

/** Only the state digest is persisted; callback lookup consumes it once. */
export function newSlackOAuthState() {
  const state = randomBytes(32).toString("base64url");
  return { state, digest: createHash("sha256").update(state).digest("hex") };
}

/** Request only bot DM delivery permissions, separate from Slack/Orbyn sign-in. */
export function slackAuthorizationUrl(config: SlackOAuthConfig, state: string) {
  const current = validateSlackOAuthConfig(config);
  if (!/^[A-Za-z0-9_-]{43}$/.test(state))
    fail(400, "This Slack connection request is unavailable.");
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: current.clientId,
    scope: SLACK_BOT_SCOPES.join(","),
    redirect_uri: current.redirectUri,
    state,
  }).toString();
  return url.href;
}

/** Validate the app, installing actor, workspace and granted bot permissions. */
export function readSlackInstallation(
  value: unknown,
  appId: string,
  now = new Date(),
): SlackInstallation {
  const parsed = responseSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.app_id !== appId ||
    !Number.isFinite(now.getTime())
  )
    fail(503, "Slack authorization could not be verified.");
  const data = parsed.data;
  const scopes = [
    ...new Set(
      data.scope
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ];
  if (
    SLACK_BOT_SCOPES.some((scope) => !scopes.includes(scope)) ||
    !!data.refresh_token !== !!data.expires_in
  )
    fail(503, "Slack authorization could not be verified.");
  const normalized = slackInstallation.safeParse({
    appId: data.app_id,
    workspaceId: data.team.id,
    workspaceName: data.team.name,
    userId: data.authed_user.id,
    botUserId: data.bot_user_id,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? new Date(now.getTime() + data.expires_in * 1000).toISOString()
      : null,
    scopes,
  });
  if (!normalized.success)
    fail(503, "Slack authorization could not be verified.");
  return normalized.data;
}

/** One bounded code exchange against Slack's fixed endpoint; caller owns single use. */
export async function exchangeSlackCode(
  config: SlackOAuthConfig,
  code: string,
  request: typeof fetch = fetch,
): Promise<SlackInstallation> {
  const current = validateSlackOAuthConfig(config);
  if (!code || code.length > 4096)
    fail(400, "This Slack connection request is unavailable.");
  try {
    const response = await request("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: current.clientId,
        client_secret: current.clientSecret,
        redirect_uri: current.redirectUri,
        code,
      }),
    });
    if (!response.ok || !response.body) throw new Error("Unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 65536) {
          await reader.cancel();
          throw new Error("Unavailable");
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    );
    return readSlackInstallation(json, current.appId);
  } catch {
    // Never publish an upstream body, OAuth code, bot token or transport error.
    fail(
      503,
      "Slack authorization could not be verified. Start a new connection.",
    );
  }
}
