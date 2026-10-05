import { createHash, randomBytes } from "node:crypto";
import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JWK,
} from "jose";
import { z } from "zod";
import { TeamsAuthenticationError } from "./teams-auth.js";

const authority = "https://login.microsoftonline.com";
const consumerTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
export type TeamsOAuthConfig = {
  clientId: string;
  clientSecret: string;
  botAppId: string;
  redirectUri: string;
};
export type MicrosoftIdentityKey = JWK & { issuer?: string };
export type TeamsUserIdentity = {
  tenantId: string;
  objectId: string;
  subject: string;
  displayName: string;
};

/** User OAuth and Bot Connector application authentication are different identities. */
export function validateTeamsOAuthConfig(
  config: TeamsOAuthConfig,
): TeamsOAuthConfig {
  const value = z
    .object({
      clientId: z.uuid(),
      botAppId: z.uuid(),
      clientSecret: z.string().min(16).max(512),
      redirectUri: z.url().max(2048),
    })
    .safeParse(config);
  if (!value.success) throw new TeamsAuthenticationError(503);
  const redirect = new URL(value.data.redirectUri);
  if (
    redirect.protocol !== "https:" ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    ![
      "/agent-channels/teams/callback",
      "/api/agent-channels/teams/callback",
    ].includes(redirect.pathname)
  )
    throw new TeamsAuthenticationError(503);
  return { ...value.data, redirectUri: redirect.href };
}
/** Changes to app, callback or credentials invalidate an outstanding account review. */
export function teamsOAuthConfigDigest(config: TeamsOAuthConfig): string {
  return createHash("sha256")
    .update(JSON.stringify(validateTeamsOAuthConfig(config)))
    .digest("hex");
}
/** Generate one unpredictable state, nonce and independent S256 verifier. */
export function newTeamsOAuthState() {
  const state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  return {
    state,
    digest: createHash("sha256").update(state).digest("hex"),
    nonce,
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
/** Organizational-account sign-in requests identity only; it cannot grant messaging or Graph writes. */
export function teamsAuthorizationUrl(
  config: TeamsOAuthConfig,
  pending: ReturnType<typeof newTeamsOAuthState>,
) {
  const current = validateTeamsOAuthConfig(config);
  for (const value of [
    pending.state,
    pending.nonce,
    pending.verifier,
    pending.challenge,
  ])
    if (!/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new TeamsAuthenticationError(400);
  if (
    createHash("sha256").update(pending.verifier).digest("base64url") !==
    pending.challenge
  )
    throw new TeamsAuthenticationError(400);
  const url = new URL(`${authority}/organizations/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: current.clientId,
    response_type: "code",
    response_mode: "query",
    redirect_uri: current.redirectUri,
    scope: "openid profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: pending.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.href;
}

/** Bounded provider JSON; token bodies and provider errors never become user-facing details. */
async function microsoftJson(
  response: Response,
  maxBytes = 65536,
): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new TeamsAuthenticationError(503);
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error();
      chunks.push(part.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new TeamsAuthenticationError(503);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Fetch tenant-specific public keys from the fixed Microsoft authority, with no private credential. */
export async function microsoftIdentityKeys(
  tenantId: string,
  request: typeof fetch = fetch,
): Promise<MicrosoftIdentityKey[]> {
  if (!z.uuid().safeParse(tenantId).success || tenantId === consumerTenant)
    throw new TeamsAuthenticationError(403);
  const response = await request(
    `${authority}/${tenantId}/discovery/v2.0/keys`,
    { redirect: "error", signal: AbortSignal.timeout(5000) },
  );
  try {
    const parsed = z
      .object({
        keys: z
          .array(
            z.object({
              kty: z.literal("RSA"),
              kid: z.string().min(1).max(200),
              n: z.string().min(1).max(8192),
              e: z.string().min(1).max(20),
              issuer: z.string().min(1).max(2048),
              alg: z.literal("RS256").optional(),
              use: z.literal("sig").optional(),
            }),
          )
          .min(1)
          .max(1024),
      })
      .parse(await microsoftJson(response, 2 * 1024 * 1024));
    return parsed.keys;
  } catch {
    throw new TeamsAuthenticationError(503);
  }
}

/** Verify a human organizational ID token. Email/name and unverified tid never authorize an owner link. */
export async function verifyTeamsUserIdentity(
  token: string,
  clientId: string,
  nonce: string,
  keys: (
    tenantId: string,
  ) => Promise<MicrosoftIdentityKey[]> = microsoftIdentityKeys,
  now = Date.now(),
): Promise<TeamsUserIdentity> {
  if (
    !token ||
    token.length > 16384 ||
    !z.uuid().safeParse(clientId).success ||
    !/^[A-Za-z0-9_-]{43}$/.test(nonce)
  )
    throw new TeamsAuthenticationError(401);
  try {
    const unverified = decodeJwt(token),
      header = decodeProtectedHeader(token);
    const tenant = z.uuid().parse(unverified.tid);
    if (
      tenant === consumerTenant ||
      header.alg !== "RS256" ||
      !header.kid ||
      header.kid.length > 200
    )
      throw new TeamsAuthenticationError(401);
    // tid is used solely to select a fixed-origin public key endpoint. It is
    // accepted as identity only after signature, issuer, audience and nonce checks.
    const issuer = `${authority}/${tenant}/v2.0`;
    const available = await keys(tenant);
    const selected = available.filter(
      (key) =>
        key.kid === header.kid &&
        key.kty === "RSA" &&
        key.issuer?.replace("{tenantid}", tenant) === issuer,
    );
    if (
      selected.length !== 1 ||
      !selected[0].n ||
      Buffer.from(selected[0].n, "base64url").length < 256
    )
      throw new TeamsAuthenticationError(401);
    const { payload } = await jwtVerify(
      token,
      createLocalJWKSet({ keys: selected }),
      {
        algorithms: ["RS256"],
        issuer,
        audience: clientId,
        requiredClaims: [
          "exp",
          "nbf",
          "iat",
          "nonce",
          "oid",
          "tid",
          "sub",
          "ver",
        ],
        currentDate: new Date(now),
        clockTolerance: 30,
        maxTokenAge: "10m",
      },
    );
    if (
      payload.aud !== clientId ||
      payload.nonce !== nonce ||
      payload.tid !== tenant ||
      payload.ver !== "2.0" ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (payload.idtyp !== undefined && payload.idtyp !== "user")
    )
      throw new TeamsAuthenticationError(401);
    return {
      tenantId: tenant,
      objectId: z.uuid().parse(payload.oid),
      subject: z.string().min(1).max(255).parse(payload.sub),
      displayName:
        typeof payload.name === "string"
          ? payload.name.trim().slice(0, 200) || "Microsoft account"
          : "Microsoft account",
    };
  } catch (error) {
    if (error instanceof TeamsAuthenticationError && error.status === 503)
      throw error;
    throw new TeamsAuthenticationError(401);
  }
}

/** One bounded code redemption. No transport replay and no personal access/refresh token persists. */
export async function exchangeTeamsCode(
  config: TeamsOAuthConfig,
  code: string,
  pending: { verifier: string; nonce: string },
  request: typeof fetch = fetch,
  keys: (tenantId: string) => Promise<MicrosoftIdentityKey[]> = (tenant) =>
    microsoftIdentityKeys(tenant, request),
  now = Date.now(),
): Promise<TeamsUserIdentity> {
  const current = validateTeamsOAuthConfig(config);
  if (
    !code ||
    code.length > 8192 ||
    !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier) ||
    !/^[A-Za-z0-9_-]{43}$/.test(pending.nonce)
  )
    throw new TeamsAuthenticationError(400);
  try {
    const response = await request(
      `${authority}/organizations/oauth2/v2.0/token`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: current.clientId,
          client_secret: current.clientSecret,
          code,
          code_verifier: pending.verifier,
          redirect_uri: current.redirectUri,
          scope: "openid profile",
        }),
      },
    );
    const tokens = z
      .object({ id_token: z.string().min(1).max(16384) })
      .parse(await microsoftJson(response));
    return await verifyTeamsUserIdentity(
      tokens.id_token,
      current.clientId,
      pending.nonce,
      keys,
      now,
    );
  } catch {
    throw new TeamsAuthenticationError(503);
  }
}
