import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWK,
} from "jose";
import { z } from "zod";

const ISSUER = "https://api.botframework.com";
const KEYS = "https://login.botframework.com/v1/.well-known/keys";
export type TeamsBotIdentity = { appId: string };
export type TeamsSigningKey = JWK & { endorsements?: string[] };
export class TeamsAuthenticationError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 413 | 503) {
    super("This Teams request is unavailable.");
    this.name = "TeamsAuthenticationError";
  }
}
const activityIdentity = z.object({
  channelId: z.literal("msteams"),
  serviceUrl: z.url().max(2048),
  recipient: z.object({ id: z.string().min(1).max(200) }),
});
/** Only the public-cloud Microsoft connector is allowed to receive bot credentials.
 * Government cloud routing needs its own issuer, key and endpoint configuration.
 */
export function teamsServiceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TeamsAuthenticationError(403);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "smba.trafficmanager.net" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value ||
    !/^\/(?:teams|amer|emea|apac)\/(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/)?$/.test(
      url.pathname,
    )
  )
    throw new TeamsAuthenticationError(403);
  return url.href;
}

/** Fetch only Microsoft's fixed key document. Token jku/x5u fields are never followed. */
export function createTeamsSigningKeyCache(
  request: typeof fetch = fetch,
  clock: () => number = Date.now,
) {
  let cached:
    { keys: TeamsSigningKey[]; until: number; refreshedAt: number } | undefined;
  let loading: Promise<TeamsSigningKey[]> | undefined;

  return async function load(refresh = false): Promise<TeamsSigningKey[]> {
    if (
      cached &&
      cached.until > clock() &&
      (!refresh || cached.refreshedAt > clock() - 60000)
    )
      return cached.keys;
    loading ??= (async () => {
      const response = await request(KEYS, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new TeamsAuthenticationError(503);
      }
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) throw new TeamsAuthenticationError(503);
          chunks.push(chunk.value);
        }
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const parsed = z
          .object({
            keys: z
              .array(
                z
                  .object({
                    kty: z.literal("RSA"),
                    kid: z.string().min(1).max(200),
                    n: z.string().min(1).max(8192),
                    e: z.string().min(1).max(20),
                    alg: z.literal("RS256").optional(),
                    use: z.literal("sig").optional(),
                    endorsements: z
                      .array(z.string().max(100))
                      .max(100)
                      .optional(),
                  })
                  .passthrough(),
              )
              .min(1)
              .max(100),
          })
          .parse(value);
        cached = {
          keys: parsed.keys as TeamsSigningKey[],
          until: clock() + 3600000,
          refreshedAt: clock(),
        };
        return cached.keys;
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    })()
      .catch(() => {
        throw new TeamsAuthenticationError(503);
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  };
}

export const teamsSigningKeys = createTeamsSigningKeyCache();

/** Verify all connector trust requirements before decoding an activity body.
 * Successful JWT authentication is not consent to link an Orbyn owner or send a DM.
 */
export async function authenticateTeamsActivity(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  identity: TeamsBotIdentity,
  keys: (refresh?: boolean) => Promise<TeamsSigningKey[]> = teamsSigningKeys,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  if (raw.byteLength > 65536) throw new TeamsAuthenticationError(413);
  if (!z.uuid().safeParse(identity.appId).success)
    throw new TeamsAuthenticationError(503);
  const authorization = headers.authorization;
  if (
    typeof authorization !== "string" ||
    authorization.length > 16384 ||
    !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      authorization,
    )
  )
    throw new TeamsAuthenticationError(401);
  const token = authorization.slice(7);
  let payload;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== "RS256" || !header.kid || header.kid.length > 200)
      throw new Error();
    let available = await keys();
    if (!available.some((key) => key.kid === header.kid))
      available = await keys(true);
    const selected = available.filter(
      (key) => key.kid === header.kid && key.kty === "RSA",
    );
    if (selected.length !== 1) throw new TeamsAuthenticationError(401);
    if (!selected[0].endorsements?.includes("msteams"))
      throw new TeamsAuthenticationError(403);
    if (!selected[0].n || Buffer.from(selected[0].n, "base64url").length < 256)
      throw new TeamsAuthenticationError(401);
    payload = (
      await jwtVerify(token, createLocalJWKSet({ keys: selected }), {
        algorithms: ["RS256"],
        issuer: ISSUER,
        audience: identity.appId,
        requiredClaims: ["exp", "nbf", "serviceUrl"],
        clockTolerance: 300,
        currentDate: new Date(now),
      })
    ).payload;
    if (payload.aud !== identity.appId) throw new TeamsAuthenticationError(401);
  } catch (error) {
    if (error instanceof TeamsAuthenticationError) throw error;
    throw new TeamsAuthenticationError(401);
  }
  const contentType = headers["content-type"];
  if (
    typeof contentType !== "string" ||
    contentType.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    throw new TeamsAuthenticationError(400);
  let value: Record<string, unknown>;
  try {
    value = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  } catch {
    throw new TeamsAuthenticationError(400);
  }
  const activity = activityIdentity.safeParse(value);
  if (!activity.success) throw new TeamsAuthenticationError(400);
  if (
    activity.data.recipient.id !== `28:${identity.appId}` ||
    payload.serviceUrl !== activity.data.serviceUrl
  )
    throw new TeamsAuthenticationError(403);
  teamsServiceUrl(activity.data.serviceUrl);
  return value;
}
