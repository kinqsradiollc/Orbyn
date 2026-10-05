import { createHash } from "node:crypto";
import { z } from "zod";
import { teamsServiceUrl } from "./teams-auth.js";

export type TeamsBotConfig = {
  appId: string;
  tenantId: string;
  clientSecret: string;
};
export type TeamsConversationReference = {
  serviceUrl: string;
  tenantId: string;
  conversationId: string;
  userId: string;
  objectId: string;
  botId: string;
};
export type TeamsSendResult =
  | { state: "sent"; activityId: string }
  | { state: "rate_limited"; retryAfterSeconds: number }
  | { state: "refused" | "unknown" | "unavailable" };
const botConfig = z
  .object({
    appId: z.uuid(),
    tenantId: z.uuid(),
    clientSecret: z.string().min(16).max(512),
  })
  .strict();
export const teamsConversationReference = z
  .object({
    serviceUrl: z.string().max(2048),
    tenantId: z.uuid(),
    conversationId: z.string().min(1).max(1000),
    userId: z
      .string()
      .regex(/^29:.+/)
      .max(500),
    objectId: z.uuid(),
    botId: z.string().min(1).max(200),
  })
  .strict();
/** Validate administrator-owned single-tenant bot credentials separately from user OAuth. */
export function validateTeamsBotConfig(value: TeamsBotConfig): TeamsBotConfig {
  return botConfig.parse(value);
}
export function teamsBotConfigDigest(value: TeamsBotConfig): string {
  return createHash("sha256")
    .update(JSON.stringify(validateTeamsBotConfig(value)))
    .digest("hex");
}
async function boundedJson(response: Response, max: number): Promise<unknown> {
  if (!response.body) throw new Error("Missing provider body");
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > max) throw new Error("Provider response exceeds budget");
      chunks.push(chunk.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
/** Client-credential issuance is cacheable, unlike one-use user OAuth codes.
 * Only fixed Microsoft endpoints receive bot secrets; no user/ChatGPT/MCP token participates.
 */
export function createTeamsBotTokenCache(
  request: typeof fetch = fetch,
  clock: () => number = Date.now,
) {
  const cache = new Map<string, { token: string; until: number }>();
  const pending = new Map<string, Promise<string>>();
  return async function token(input: TeamsBotConfig): Promise<string> {
    const config = validateTeamsBotConfig(input),
      digest = teamsBotConfigDigest(config);
    for (const [key, entry] of cache)
      if (entry.until <= clock()) cache.delete(key);
    const cached = cache.get(digest);
    if (cached && cached.until > clock()) return cached.token;
    let loading = pending.get(digest);
    if (!loading) {
      loading = (async () => {
        const response = await request(
          `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              client_id: config.appId,
              client_secret: config.clientSecret,
              scope: "https://api.botframework.com/.default",
            }),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Teams bot credentials unavailable");
        }
        const result = z
          .object({
            token_type: z.literal("Bearer"),
            access_token: z
              .string()
              .min(1)
              .max(16384)
              .regex(/^[A-Za-z0-9._~-]+$/),
            expires_in: z.number().int().min(60).max(86400),
          })
          .parse(await boundedJson(response, 65536));
        // The process has one configured bot; cap historical rotated credentials too.
        if (cache.size >= 4) cache.delete(cache.keys().next().value!);
        cache.set(digest, {
          token: result.access_token,
          until: clock() + Math.min(result.expires_in - 30, 3600) * 1000,
        });
        return result.access_token;
      })()
        .catch(() => {
          throw new Error("Teams bot credentials unavailable");
        })
        .finally(() => pending.delete(digest));
      pending.set(digest, loading);
    }
    return loading;
  };
}
/** A transport timeout or ambiguous response is never replayed automatically.
 * Only an explicit 429 reports a bounded delay for the durable outbox to schedule.
 */
export function createTeamsTransport(
  request: typeof fetch = fetch,
  clock: () => number = Date.now,
) {
  const token = createTeamsBotTokenCache(request, clock);
  return async function send(
    configInput: TeamsBotConfig,
    targetInput: TeamsConversationReference,
    text: string,
  ): Promise<TeamsSendResult> {
    let config: TeamsBotConfig,
      target: TeamsConversationReference,
      destination: string;
    try {
      config = validateTeamsBotConfig(configInput);
      target = teamsConversationReference.parse(targetInput);
      if (target.botId !== `28:${config.appId}`) return { state: "refused" };
      destination = `${teamsServiceUrl(target.serviceUrl)}v3/conversations/${encodeURIComponent(target.conversationId)}/activities`;
      z.string()
        .min(1)
        .max(8000)
        .refine(
          (value) =>
            !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
        )
        .parse(text);
    } catch {
      return { state: "refused" };
    }
    let accessToken: string;
    try {
      accessToken = await token(config);
    } catch {
      return { state: "unavailable" };
    }
    try {
      const response = await request(destination, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "message",
          textFormat: "plain",
          text,
          from: { id: target.botId },
          recipient: { id: target.userId },
          conversation: { id: target.conversationId },
          channelData: { tenant: { id: target.tenantId } },
        }),
      });
      if (response.status === 429) {
        await response.body?.cancel();
        const raw = response.headers.get("retry-after");
        const seconds = raw && /^\d{1,5}$/.test(raw) ? Number(raw) : 30;
        return {
          state: "rate_limited",
          retryAfterSeconds: Math.max(1, Math.min(seconds, 3600)),
        };
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 410
      ) {
        await response.body?.cancel();
        return { state: "refused" };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { state: "unknown" };
      }
      const result = z
        .object({ id: z.string().min(1).max(500) })
        .parse(await boundedJson(response, 32768));
      return { state: "sent", activityId: result.id };
    } catch {
      return { state: "unknown" };
    }
  };
}

/** Shared production cache uses only the configured bot application identity. */
export const sendTeamsMessage = createTeamsTransport();
