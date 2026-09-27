import {
  createLocalJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyOptions,
} from "jose";
import { oauthIssuer } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { safeFetch } from "../../lib/netguard.js";
import {
  ASSERTION_ALGS,
  fetchDocument,
  logClientAuth,
  OAuthError,
  publicJwks,
  storedClient,
  type ClientRow,
  type PublicJwk,
} from "./clients.js";

/**
 * How an app proves itself at the token endpoint.
 *
 * Public apps (token_endpoint_auth_method "none") prove nothing beyond the
 * PKCE verifier. An app whose client ID metadata document declares
 * private_key_jwt must also send a signed assertion (RFC 7523, OpenID
 * Connect Core §9) with every code exchange and refresh:
 *
 * - `client_assertion_type` is the jwt-bearer URN and `client_assertion`
 *   a JWT signed with one of the keys its document publishes (inline
 *   `jwks`, or `jwks_uri` fetched like the document: https only, public
 *   addresses only, 64 KB, 5 s, redirects checked again, ETag cache);
 * - RS256, PS256 or ES256 only (never "none" or a shared-secret HS*);
 * - `iss` and `sub` are its client_id, `aud` is the token endpoint (the
 *   issuer is accepted too), `exp` is in the future and at most 5 minutes
 *   away, `iat` and `nbf` are sane within 30 s of clock skew;
 * - `jti` is spent on first use and remembered until the assertion
 *   expires, so a copied assertion can't be replayed.
 *
 * PKCE stays required for every app. Nothing here ever stores or logs an
 * assertion; failures are logged with the client id and method only.
 */

export const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
/** The longest an assertion may be valid for. */
export const ASSERTION_MAX_SECONDS = 300;
/** Clock skew allowed between the app and Orbyn. */
export const ASSERTION_SKEW_SECONDS = 30;
/** How soon keys may be read again when an unknown key shows up. */
const KEY_REFETCH_SECONDS = 60;

/** The token endpoint's address, as the metadata names it. */
export const tokenEndpoint = () => `${oauthIssuer()}/api/oauth/token`;

/** A failed client authentication (RFC 6749 §5.2: 401 invalid_client). */
const refused = (
  clientId: string,
  method: string,
  message: string,
): OAuthError => {
  logClientAuth("client authentication failed", clientId, method, message);
  return new OAuthError("invalid_client", message, 401);
};

/**
 * The client id of an HTTP Basic header (RFC 6749 §2.3.1); its secret means
 * nothing here. Any other Authorization header is ignored, as it always was.
 */
function basicCredentials(header: string | undefined): string | null {
  if (!header || !/^Basic\s/i.test(header)) return null;
  const m = header.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i);
  if (!m)
    throw new OAuthError(
      "invalid_request",
      "The Authorization header isn't valid Basic credentials.",
    );
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 1)
    throw new OAuthError(
      "invalid_request",
      "The Authorization header doesn't name a client.",
    );
  try {
    return decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
  } catch {
    throw new OAuthError(
      "invalid_request",
      "The Authorization header doesn't name a client.",
    );
  }
}

/** The keys that may sign for a client, read again when `force` (and due). */
async function clientKeys(
  row: ClientRow,
  force: boolean,
): Promise<{ row: ClientRow; keys: PublicJwk[] }> {
  const m = row.metadata;
  if (m.jwks_uri) {
    const cache = m.jwks_cache;
    const age = cache ? (Date.now() - cache.fetched_at) / 1000 : Infinity;
    if (
      cache &&
      (force ? age < KEY_REFETCH_SECONDS : age < cache.cache_seconds)
    )
      return { row, keys: cache.keys };
    let res;
    try {
      res = await safeFetch(m.jwks_uri, {
        headers: {
          accept: "application/json, application/jwk-set+json",
          "user-agent": "Orbyn (+https://orbyn.dev)",
          ...(cache?.etag ? { "if-none-match": cache.etag } : {}),
        },
      });
    } catch (e) {
      // Can't reach it: keys read before still do, for up to a day.
      if (cache && age < 86_400) return { row, keys: cache.keys };
      throw refused(
        row.id,
        "private_key_jwt",
        `Couldn't read this app's keys at ${new URL(m.jwks_uri).hostname}${e instanceof Error ? ` (${e.message.replace(/\.$/, "")})` : ""}.`,
      );
    }
    const header = res.headers.get("cache-control");
    const asked = Number(header?.match(/max-age=(\d+)/i)?.[1] ?? 3600);
    const seconds = /no-store|no-cache/i.test(header ?? "")
      ? 300
      : Math.min(86_400, Math.max(300, asked));
    let keys: PublicJwk[];
    if (res.status === 304 && cache) keys = cache.keys;
    else if (res.status === 200) {
      let parsed: PublicJwk[] | string;
      try {
        parsed = publicJwks(JSON.parse(res.text));
      } catch {
        parsed = "its key set isn't valid JSON";
      }
      if (typeof parsed === "string")
        throw refused(
          row.id,
          "private_key_jwt",
          `This app's keys can't be used: ${parsed}.`,
        );
      keys = parsed;
    } else
      throw refused(
        row.id,
        "private_key_jwt",
        `This app's keys couldn't be read (${res.status}).`,
      );
    const next = {
      keys,
      etag: res.headers.get("etag")?.slice(0, 200) ?? cache?.etag ?? null,
      fetched_at: Date.now(),
      cache_seconds: seconds,
    };
    await pool.query(
      `UPDATE oauth_clients SET metadata = metadata || jsonb_build_object('jwks_cache', $2::jsonb)
        WHERE id = $1`,
      [row.id, JSON.stringify(next)],
    );
    return { row: { ...row, metadata: { ...m, jwks_cache: next } }, keys };
  }
  // Keys in the document itself: a new key means reading the document again.
  const age = row.fetched_at
    ? (Date.now() - row.fetched_at.getTime()) / 1000
    : Infinity;
  if (force && age >= KEY_REFETCH_SECONDS) {
    try {
      const fresh = await fetchDocument(row.id, row);
      if (fresh.metadata?.auth_method === "private_key_jwt")
        return { row: fresh, keys: fresh.metadata.jwks ?? [] };
    } catch {
      // The document as it was still decides.
    }
  }
  return { row, keys: m.jwks ?? [] };
}

/** Verifies `assertion` with `keys`, trying each key a header could mean. */
async function verifyWith(
  assertion: string,
  keys: PublicJwk[],
  options: JWTVerifyOptions,
): Promise<JWTPayload> {
  const set = createLocalJWKSet({ keys: keys as never });
  try {
    return (await jwtVerify(assertion, set, options)).payload;
  } catch (e) {
    // Several keys fit a header without a kid: any one of them may sign.
    if ((e as { code?: string }).code !== "ERR_JWKS_MULTIPLE_MATCHING_KEYS")
      throw e;
    let last: unknown = e;
    for await (const key of e as AsyncIterable<CryptoKey>) {
      try {
        return (await jwtVerify(assertion, key, options)).payload;
      } catch (inner) {
        last = inner;
        if (
          (inner as { code?: string }).code !==
          "ERR_JWS_SIGNATURE_VERIFICATION_FAILED"
        )
          throw inner;
      }
    }
    throw last;
  }
}

/** A JOSE failure in words, for error_description. */
function why(e: unknown): string {
  const err = e as { code?: string; claim?: string; message?: string };
  switch (err.code) {
    case "ERR_JWT_EXPIRED":
      return "The client assertion has expired.";
    case "ERR_JOSE_ALG_NOT_ALLOWED":
    case "ERR_JOSE_NOT_SUPPORTED":
      return `The client assertion must be signed with ${ASSERTION_ALGS.join(", ")}.`;
    case "ERR_JWKS_NO_MATCHING_KEY":
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return "The client assertion isn't signed with one of this app's keys.";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED":
      if (err.claim === "aud")
        return `The client assertion is for another server (its aud must be ${tokenEndpoint()}).`;
      if (err.claim === "iss" || err.claim === "sub")
        return "The client assertion's iss and sub must both be the client_id.";
      if (err.claim === "nbf" || err.claim === "iat")
        return "The client assertion isn't valid yet.";
      return `The client assertion is missing or has a wrong ${err.claim ?? "claim"}.`;
    default:
      return "The client assertion isn't a valid signed JWT.";
  }
}

/** Spends an assertion's jti; false when it was already used. */
async function spendJti(
  clientId: string,
  jti: string,
  exp: number,
): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO oauth_client_assertions (client_id, jti_hash, expires_at)
     VALUES ($1, $2, to_timestamp($3))
     ON CONFLICT (client_id, jti_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at
       WHERE oauth_client_assertions.expires_at < now()`,
    [clientId, digest(jti), exp + ASSERTION_SKEW_SECONDS],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Checks a private_key_jwt assertion for `row`, and spends its jti. */
async function verifyAssertion(row: ClientRow, assertion: string) {
  const clientId = row.id;
  const method = "private_key_jwt";
  const allowed = row.metadata.auth_alg
    ? [row.metadata.auth_alg]
    : [...ASSERTION_ALGS];
  const options: JWTVerifyOptions = {
    algorithms: allowed,
    issuer: clientId,
    subject: clientId,
    audience: [tokenEndpoint(), oauthIssuer()],
    clockTolerance: ASSERTION_SKEW_SECONDS,
    requiredClaims: ["exp", "jti"],
  };
  if (assertion.length > 8192)
    throw refused(clientId, method, "The client assertion is too long.");
  let { row: current, keys } = await clientKeys(row, false);
  let payload: JWTPayload;
  try {
    payload = await verifyWith(assertion, keys, options);
  } catch (e) {
    const code = (e as { code?: string }).code;
    // A key Orbyn hasn't seen yet: the app may have rotated. Read its keys
    // again (at most once a minute) and try once more.
    if (
      code !== "ERR_JWKS_NO_MATCHING_KEY" &&
      code !== "ERR_JWS_SIGNATURE_VERIFICATION_FAILED"
    )
      throw refused(clientId, method, why(e));
    ({ row: current, keys } = await clientKeys(current, true));
    try {
      payload = await verifyWith(assertion, keys, options);
    } catch (again) {
      throw refused(clientId, method, why(again));
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = payload.exp!;
  if (exp > now + ASSERTION_MAX_SECONDS + ASSERTION_SKEW_SECONDS)
    throw refused(
      clientId,
      method,
      `The client assertion lasts too long (at most ${ASSERTION_MAX_SECONDS / 60} minutes).`,
    );
  if (payload.iat !== undefined) {
    if (payload.iat > now + ASSERTION_SKEW_SECONDS)
      throw refused(
        clientId,
        method,
        "The client assertion was issued in the future.",
      );
    if (exp - payload.iat > ASSERTION_MAX_SECONDS)
      throw refused(
        clientId,
        method,
        `The client assertion lasts too long (at most ${ASSERTION_MAX_SECONDS / 60} minutes).`,
      );
  }
  const jti = payload.jti;
  if (typeof jti !== "string" || !jti || jti.length > 256)
    throw refused(clientId, method, "The client assertion needs a jti.");
  if (!(await spendJti(clientId, jti, exp)))
    throw refused(
      clientId,
      method,
      "This client assertion was already used. Sign a new one for every request.",
    );
}

/**
 * Authenticates the app calling the token endpoint and returns its
 * client_id (from the form, an HTTP Basic header, or the assertion's
 * subject). Public apps pass with nothing more (PKCE is checked with the
 * code); an app that signs in with a key must send a valid assertion; an
 * assertion from an app that doesn't is refused.
 */
export async function authenticateClient(
  p: Record<string, string | undefined>,
  authorization: string | undefined,
): Promise<string | undefined> {
  const basic = basicCredentials(authorization);
  const assertion = p.client_assertion;
  const assertionType = p.client_assertion_type;
  if (assertion !== undefined || assertionType !== undefined) {
    if (assertionType !== CLIENT_ASSERTION_TYPE)
      throw new OAuthError(
        "invalid_client",
        `client_assertion_type must be ${CLIENT_ASSERTION_TYPE}.`,
        401,
      );
    if (!assertion)
      throw new OAuthError(
        "invalid_client",
        "client_assertion is required with client_assertion_type.",
        401,
      );
    if (basic !== null)
      throw new OAuthError(
        "invalid_request",
        "Use one way to authenticate the app: a client assertion or an Authorization header, not both.",
      );
  }
  let unverifiedSub: string | undefined;
  if (assertion) {
    try {
      const claims = decodeJwt(assertion);
      unverifiedSub =
        typeof claims.sub === "string" ? claims.sub.slice(0, 2000) : undefined;
    } catch {
      unverifiedSub = undefined;
    }
  }
  if (basic !== null && p.client_id && basic !== p.client_id)
    throw new OAuthError(
      "invalid_request",
      "The client_id in the form and in the Authorization header differ.",
    );
  const clientId = p.client_id || basic || unverifiedSub;
  if (!clientId) {
    if (assertion)
      throw new OAuthError(
        "invalid_client",
        "The client assertion doesn't name the app (sub).",
        401,
      );
    return undefined;
  }
  const row = await storedClient(clientId);
  const method = row?.metadata?.auth_method ?? "none";
  if (method === "private_key_jwt" && row) {
    if (!assertion)
      throw refused(
        clientId,
        method,
        `This app signs in with a signed key: send client_assertion_type=${CLIENT_ASSERTION_TYPE} and a client_assertion.`,
      );
    if (basic !== null)
      throw refused(
        clientId,
        method,
        "This app signs in with a signed key, not an Authorization header.",
      );
    await verifyAssertion(row, assertion);
    return clientId;
  }
  if (assertion) {
    if (!row) throw refused(clientId, method, "Orbyn doesn't know this app.");
    throw refused(
      clientId,
      method,
      "This app is a public app: it doesn't sign in with a key, so it mustn't send a client assertion.",
    );
  }
  // A public app: an Authorization header or client_secret (an app whose
  // document declared client_secret_*) carries nothing Orbyn issued, and is
  // ignored. PKCE decides, with the code.
  return clientId;
}
