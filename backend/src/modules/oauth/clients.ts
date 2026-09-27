import { createHash, randomBytes } from "node:crypto";
import { AGENT_KEY_CLIENT_ID, LEGACY_KEY_CLIENT_ID } from "@orbyn/core";
import { pool, type Queryable } from "../../db/pool.js";
import { safeFetch } from "../../lib/netguard.js";
import type { LiveSettings } from "../../lib/settings.js";

/**
 * The apps that sign in with Orbyn, and how Orbyn knows them.
 *
 * Preferred: a client ID metadata document (CIMD). The app's id is an https
 * address, and the document there says its name and where it may send
 * people back. Orbyn fetches it through netguard's safeFetch (https only,
 * public addresses only, pinned, each redirect checked again, 64 KB, 5 s),
 * keeps it in oauth_clients with its ETag, and uses it until it goes stale.
 * The id is the proof: an app can't claim a website it doesn't serve.
 *
 * Fallback: dynamic client registration (DCR, RFC 7591), which admins can
 * switch off. Anyone can register, so it's rate limited per address and the
 * app's name is shown as unverified; registrations nobody uses are swept
 * after a week.
 *
 * Every client uses PKCE. Most are public (token_endpoint_auth_method
 * "none"). A CIMD app may also prove itself at the token endpoint with a
 * key (private_key_jwt, RFC 7523): its document publishes the public keys
 * (`jwks`, or `jwks_uri`, fetched as safely as the document) and
 * client-auth.ts checks every assertion. Nothing ever holds a client
 * secret: a CIMD document that declares client_secret_basic or
 * client_secret_post is served as a public app (no secret can exist for
 * it, and PKCE still binds the code), with the declared method kept on its
 * row; any other method is refused, by name.
 */

/** An OAuth error, answered as RFC 6749 / RFC 7591 describe. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** A client as the rest of the sign-in sees it. */
export type OAuthClient = {
  id: string;
  kind: "cimd" | "dcr";
  name: string;
  /** The website it comes from (CIMD), or where it sends people back (DCR). */
  host: string;
  /** Whether the id itself proves where it comes from (CIMD). */
  verified: boolean;
  redirect_uris: string[];
};

/** How an app proves itself at the token endpoint. */
export type ClientAuthMethod = "none" | "private_key_jwt";

/** The only signing algorithms Orbyn accepts for a client's assertion. */
export const ASSERTION_ALGS = ["RS256", "PS256", "ES256"] as const;

/** A public key an app published for its assertions (RSA, or EC P-256). */
export type PublicJwk = {
  kty: "RSA" | "EC";
  kid?: string;
  alg?: string;
  use?: "sig";
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
};

/** What a stored client row keeps about its authentication. */
export type ClientMetadata = {
  cache_seconds?: number;
  /** How it proves itself at the token endpoint (missing: "none"). */
  auth_method?: ClientAuthMethod;
  /** The method its document declared, when that differs (client_secret_*). */
  declared_auth_method?: string | null;
  /** The one algorithm its document says it signs with, if it said. */
  auth_alg?: string | null;
  /** Its public keys, when the document holds them. */
  jwks?: PublicJwk[] | null;
  /** Where its public keys are published, otherwise. */
  jwks_uri?: string | null;
  /** The keys last read from jwks_uri. */
  jwks_cache?: {
    keys: PublicJwk[];
    etag: string | null;
    fetched_at: number;
    cache_seconds: number;
  } | null;
} & Record<string, unknown>;

export type ClientRow = {
  id: string;
  kind: "cimd" | "dcr";
  name: string;
  host: string;
  redirect_uris: string[];
  metadata: ClientMetadata;
  etag: string | null;
  fetched_at: Date | null;
  blocked: boolean;
};

/** Ids that name Orbyn's own kinds of connection, never an app. */
const RESERVED_IDS = new Set([AGENT_KEY_CLIENT_ID, LEGACY_KEY_CLIENT_ID]);

/** DCR ids look like this. */
const DCR_ID = /^dcr_[A-Za-z0-9_-]{20,64}$/;

/** A name fit to show: no control or direction characters, one line, short. */
export function cleanName(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? raw : "";
  const clean = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return clean || fallback;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Schemes that must never receive a code. */
const BAD_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
  "ftp:",
  "ws:",
  "wss:",
  "mailto:",
  "tel:",
  "sms:",
]);

/** Whether an address sends people back to this computer. */
export const isLoopback = (uri: string) => {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
};

/**
 * Whether `uri` may be a redirect address: https anywhere, http only back to
 * this computer (RFC 8252), or an app's own scheme; never a fragment.
 */
export function validRedirectUri(uri: string): boolean {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return !!u.hostname;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  return (
    !BAD_SCHEMES.has(u.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(u.protocol)
  );
}

/**
 * Whether a requested redirect matches one the app declared: exactly, except
 * that addresses back to this computer may use any port (RFC 8252 §7.3).
 */
export function redirectAllowed(
  client: OAuthClient,
  requested: string,
): boolean {
  if (client.redirect_uris.includes(requested)) return true;
  if (!isLoopback(requested)) return false;
  const want = new URL(requested);
  return client.redirect_uris.some((r) => {
    if (!isLoopback(r)) return false;
    const u = new URL(r);
    return (
      u.hostname === want.hostname &&
      u.pathname === want.pathname &&
      u.search === want.search
    );
  });
}

/** Whether a host is allowed by Admin → Agents (an empty list allows all). */
export function hostAllowed(host: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Every website an app could send a code to. A CIMD app is its id's host
 * (its document can only list addresses it serves). A self-registered (DCR)
 * app is every https host among its redirect addresses: any of them may
 * receive a code, so every one must pass Admin → Agents. A DCR app with no
 * https address is known by its stored host ("this computer", "an app on
 * this device").
 */
export function clientHosts(c: {
  kind: string | null;
  host: string | null;
  redirect_uris: string[] | null;
}): string[] {
  const hosts = new Set<string>();
  if (c.host) hosts.add(c.host.toLowerCase());
  if (c.kind === "dcr")
    for (const uri of c.redirect_uris ?? []) {
      try {
        const u = new URL(uri);
        if (u.protocol === "https:" && u.hostname)
          hosts.add(u.hostname.toLowerCase());
      } catch {
        // Stored addresses were checked at registration; skip anything odd.
      }
    }
  return [...hosts];
}

/**
 * The first of an app's websites Admin → Agents doesn't allow, or null when
 * every one is allowed (or the list is empty).
 */
export function disallowedHost(
  c: {
    kind: string | null;
    host: string | null;
    redirect_uris: string[] | null;
  },
  allowed: string[],
): string | null {
  if (!allowed.length) return null;
  const hosts = clientHosts(c);
  if (!hosts.length) return c.host ?? "";
  return hosts.find((h) => !hostAllowed(h, allowed)) ?? null;
}

/** Where an app sends people back, for the consent page. */
export function redirectHost(uri: string): { host: string; local: boolean } {
  if (isLoopback(uri)) return { host: "this computer", local: true };
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return { host: u.hostname, local: false };
    // An app's own scheme opens an app on this device.
    return { host: "an app on this device", local: true };
  } catch {
    return { host: "", local: false };
  }
}

/**
 * Where a redirect address sends people, for telling whether a registration
 * mixes places: an https website's host, "this computer" for any loopback
 * address (RFC 8252 lets its port vary), or an app's own scheme.
 */
function redirectPlace(uri: string): string {
  if (isLoopback(uri)) return "loopback";
  const u = new URL(uri);
  return u.protocol === "https:"
    ? `https://${u.hostname.toLowerCase()}`
    : u.protocol;
}

/** How long a fetched document is trusted: its max-age within 10 min – 24 h. */
function cacheSeconds(header: string | null): number {
  const m = header?.match(/max-age=(\d+)/i);
  const asked = m ? Number(m[1]) : 3600;
  if (/no-store|no-cache/i.test(header ?? "")) return 600;
  return Math.min(86_400, Math.max(600, asked));
}

const toClient = (row: ClientRow): OAuthClient => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  host: row.host,
  verified: row.kind === "cimd",
  redirect_uris: row.redirect_uris,
});

/** The checks every client passes, however it's known. */
function usable(row: ClientRow, s: LiveSettings) {
  if (row.blocked || s.agents.blocked_client_ids.includes(row.id))
    throw new OAuthError(
      "unauthorized_client",
      "This app has been blocked by the administrator of this Orbyn.",
    );
  const refused = disallowedHost(row, s.agents.allowed_client_hosts);
  if (refused !== null)
    throw new OAuthError(
      "unauthorized_client",
      `Apps from ${refused || row.host} can't connect to this Orbyn.`,
    );
}

/** Methods Orbyn knows but doesn't support, in plain words. */
const METHOD_WORDS: Record<string, string> = {
  client_secret_jwt: "a token signed with a shared secret (client_secret_jwt)",
  tls_client_auth: "a client certificate (tls_client_auth)",
  self_signed_tls_client_auth:
    "a self-signed client certificate (self_signed_tls_client_auth)",
  private_key_jwt: "a signed key (private_key_jwt)",
};

/** A declared method, fit to show and log: printable, short. */
const methodName = (raw: unknown) =>
  cleanName(typeof raw === "string" ? raw : (JSON.stringify(raw) ?? ""), "?")
    .replace(/["\\]/g, "")
    .slice(0, 40);

/** A method in words people can read. */
export const methodWords = (raw: unknown) => {
  const name = methodName(raw);
  return METHOD_WORDS[name] ?? `a method called "${name}"`;
};

/**
 * Notes a refused or downgraded client in the server log: the client id and
 * the method it declared, never anything secret.
 */
export function logClientAuth(
  event: string,
  clientId: string,
  method: unknown,
  reason?: string,
) {
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: `oauth: ${event}`,
      client_id: clientId.slice(0, 300),
      method: methodName(method),
      ...(reason ? { reason } : {}),
    }),
  );
}

/** JWK members that only a private or secret key has. */
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

/**
 * The usable public signing keys of a JWK set (RSA, or EC P-256), or why
 * there are none. A set holding any private key is refused outright: anyone
 * who read it could sign as the app.
 */
export function publicJwks(raw: unknown): PublicJwk[] | string {
  const keys =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { keys?: unknown }).keys
      : undefined;
  if (!Array.isArray(keys) || !keys.length || keys.length > 20)
    return "its key set isn't valid (a JSON object with 1 to 20 keys)";
  const out: PublicJwk[] = [];
  for (const k of keys) {
    if (!k || typeof k !== "object" || Array.isArray(k)) continue;
    const j = k as Record<string, unknown>;
    if (PRIVATE_MEMBERS.some((m) => m in j))
      return "it publishes a private or secret key, which anyone could sign with";
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    if (j.use !== undefined && j.use !== "sig") continue;
    if (
      j.key_ops !== undefined &&
      !(Array.isArray(j.key_ops) && j.key_ops.includes("verify"))
    )
      continue;
    if (
      j.alg !== undefined &&
      !(ASSERTION_ALGS as readonly unknown[]).includes(j.alg)
    )
      continue;
    const kid = str(j.kid)?.slice(0, 200);
    const alg = str(j.alg);
    const base = {
      ...(kid ? { kid } : {}),
      ...(alg ? { alg } : {}),
      ...(j.use === "sig" ? { use: "sig" as const } : {}),
    };
    if (j.kty === "RSA" && str(j.n) && str(j.e) && alg !== "ES256")
      out.push({ kty: "RSA", n: str(j.n), e: str(j.e), ...base });
    else if (
      j.kty === "EC" &&
      j.crv === "P-256" &&
      str(j.x) &&
      str(j.y) &&
      (alg === undefined || alg === "ES256")
    )
      out.push({ kty: "EC", crv: "P-256", x: str(j.x), y: str(j.y), ...base });
  }
  return out.length
    ? out
    : "it has no RSA or P-256 signing key Orbyn can use (RS256, PS256 or ES256)";
}

/** An address Orbyn would fetch keys from: https, no credentials or fragment. */
function keysUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hash || u.username || u.password)
      return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * How a CIMD app proves itself at the token endpoint, from its document.
 * "none" (or nothing) is a public app. client_secret_basic/_post can't mean
 * anything here (Orbyn never gave it a secret), so it is served as a public
 * app with PKCE, and the declared method is kept. private_key_jwt needs its
 * public keys. Anything else is refused, naming the method.
 */
function documentAuth(url: string, doc: Record<string, unknown>, app: string) {
  const declared = doc.token_endpoint_auth_method ?? "none";
  const refuse = (message: string, reason: string): never => {
    logClientAuth("client refused", url, declared, reason);
    throw new OAuthError("invalid_client", message);
  };
  if (declared === "none")
    return { auth_method: "none" as const, declared_auth_method: null };
  if (declared === "client_secret_basic" || declared === "client_secret_post") {
    logClientAuth("served as a public app", url, declared);
    return {
      auth_method: "none" as const,
      declared_auth_method: declared,
    };
  }
  if (declared !== "private_key_jwt")
    return refuse(
      `${app} asks to sign in with ${methodWords(declared)}, which Orbyn doesn't support yet. It can sign in as a public app with PKCE ("none") or with a signed key ("private_key_jwt").`,
      "unsupported method",
    );
  const alg = doc.token_endpoint_auth_signing_alg;
  if (
    alg !== undefined &&
    !(ASSERTION_ALGS as readonly unknown[]).includes(alg)
  )
    return refuse(
      `${app} asks to sign its key assertions with ${methodName(alg)}, which Orbyn doesn't support yet (only RS256, PS256 or ES256).`,
      "unsupported signing algorithm",
    );
  if (doc.jwks !== undefined && doc.jwks_uri !== undefined)
    return refuse(
      `${app}'s description gives both jwks and jwks_uri; it must give one.`,
      "jwks and jwks_uri",
    );
  const base = {
    auth_method: "private_key_jwt" as const,
    declared_auth_method: null,
    auth_alg: (alg as string | undefined) ?? null,
  };
  if (doc.jwks !== undefined) {
    const keys = publicJwks(doc.jwks);
    if (typeof keys === "string")
      return refuse(
        `${app} signs in with a signed key, but ${keys}.`,
        "unusable jwks",
      );
    return { ...base, jwks: keys, jwks_uri: null };
  }
  if (doc.jwks_uri !== undefined) {
    const where = keysUrl(doc.jwks_uri);
    if (!where)
      return refuse(
        `${app} signs in with a signed key, but its jwks_uri isn't an https address.`,
        "bad jwks_uri",
      );
    return { ...base, jwks: null, jwks_uri: where };
  }
  return refuse(
    `${app} signs in with a signed key (private_key_jwt), but its description doesn't publish its keys (jwks or jwks_uri).`,
    "no keys",
  );
}

/** Reads and checks a client ID metadata document. */
function parseDocument(url: string, text: string) {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OAuthError(
      "invalid_client",
      "This app's description isn't valid JSON.",
    );
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc))
    throw new OAuthError(
      "invalid_client",
      "This app's description isn't valid.",
    );
  if (doc.client_id !== url)
    throw new OAuthError(
      "invalid_client",
      "This app's description names a different app.",
    );
  const uris = doc.redirect_uris;
  if (
    !Array.isArray(uris) ||
    !uris.length ||
    uris.length > 20 ||
    !uris.every((u) => typeof u === "string" && validRedirectUri(u))
  )
    throw new OAuthError(
      "invalid_client",
      "This app's description doesn't say where to send you back.",
    );
  const host = new URL(url).hostname;
  const name = cleanName(doc.client_name, host);
  const auth = documentAuth(url, doc, name);
  const grants = doc.grant_types;
  if (
    grants !== undefined &&
    (!Array.isArray(grants) || !grants.includes("authorization_code"))
  )
    throw new OAuthError(
      "invalid_client",
      "This app doesn't use sign-in codes.",
    );
  return {
    name,
    host,
    redirect_uris: uris as string[],
    // Only what's worth keeping; never a logo (shown pages stay first-party).
    metadata: {
      client_uri:
        typeof doc.client_uri === "string"
          ? doc.client_uri.slice(0, 500)
          : null,
      software_id:
        typeof doc.software_id === "string"
          ? doc.software_id.slice(0, 200)
          : null,
      software_version:
        typeof doc.software_version === "string"
          ? doc.software_version.slice(0, 60)
          : null,
      ...auth,
    },
  };
}

/** Whether a string is a client id metadata document URL we'd fetch. */
function cimdUrl(id: string): URL | null {
  if (!id.startsWith("https://") || id.length > 2000) return null;
  try {
    const u = new URL(id);
    // A document at the site root can't be told from the site itself.
    if (u.protocol !== "https:" || u.hash || u.username || u.password)
      return null;
    if (u.pathname === "/" || !u.pathname) return null;
    if (u.toString() !== id) return null;
    return u;
  } catch {
    return null;
  }
}

/** Fetches (or refreshes) a CIMD client, keeping its ETag. */
export async function fetchDocument(
  url: string,
  cached: ClientRow | undefined,
): Promise<ClientRow> {
  let res;
  try {
    res = await safeFetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Orbyn (+https://orbyn.dev)",
        ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
      },
    });
  } catch (e) {
    // Can't reach it: a copy fetched before still does, for up to a week.
    if (
      cached?.fetched_at &&
      Date.now() - cached.fetched_at.getTime() < 7 * 86_400_000
    )
      return cached;
    const why = e instanceof Error ? e.message : "";
    throw new OAuthError(
      "invalid_client",
      `Couldn't read this app's description at ${new URL(url).hostname}${why ? ` (${why.replace(/\.$/, "")})` : ""}.`,
    );
  }
  const seconds = cacheSeconds(res.headers.get("cache-control"));
  if (res.status === 304 && cached) {
    await pool.query(
      `UPDATE oauth_clients SET fetched_at = now(),
         metadata = metadata || jsonb_build_object('cache_seconds', $2::int)
       WHERE id = $1`,
      [url, seconds],
    );
    return {
      ...cached,
      fetched_at: new Date(),
      metadata: { ...cached.metadata, cache_seconds: seconds },
    };
  }
  if (res.status !== 200)
    throw new OAuthError(
      "invalid_client",
      `This app's description couldn't be read (${res.status}).`,
    );
  const doc = parseDocument(url, res.text);
  const row = (
    await pool.query<ClientRow>(
      `INSERT INTO oauth_clients (id, kind, name, host, redirect_uris, metadata, etag, fetched_at)
       VALUES ($1, 'cimd', $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, host = EXCLUDED.host,
         redirect_uris = EXCLUDED.redirect_uris, metadata = EXCLUDED.metadata,
         etag = EXCLUDED.etag, fetched_at = now()
       RETURNING id, kind, name, host, redirect_uris, metadata, etag, fetched_at, blocked`,
      [
        url,
        doc.name,
        doc.host,
        doc.redirect_uris,
        { ...doc.metadata, cache_seconds: seconds },
        res.headers.get("etag")?.slice(0, 200) ?? null,
      ],
    )
  ).rows[0];
  return row;
}

const CLIENT_COLUMNS =
  "id, kind, name, host, redirect_uris, metadata, etag, fetched_at, blocked";

/** Whether a cached CIMD row is still within its cache time. */
const freshRow = (row: ClientRow) =>
  !!row.fetched_at &&
  Date.now() - row.fetched_at.getTime() <
    (row.metadata?.cache_seconds ?? 3600) * 1000;

/**
 * A client as the token endpoint needs it: the stored row, with a CIMD
 * document refreshed when it has gone stale (so a new key or a new method
 * applies). The token endpoint never fails because a document can't be
 * read again: the copy it has still decides.
 */
export async function storedClient(
  clientId: string,
): Promise<ClientRow | undefined> {
  const cached = (
    await pool.query<ClientRow>(
      `SELECT ${CLIENT_COLUMNS} FROM oauth_clients WHERE id = $1`,
      [clientId],
    )
  ).rows[0];
  if (!cached || cached.kind !== "cimd" || freshRow(cached)) return cached;
  try {
    return await fetchDocument(clientId, cached);
  } catch (e) {
    logClientAuth(
      "kept a stale client description",
      clientId,
      cached.metadata?.auth_method ?? "none",
      e instanceof Error ? e.message.slice(0, 200) : undefined,
    );
    return cached;
  }
}

/**
 * The app behind a client_id, checked: known, not blocked, from an allowed
 * host. CIMD documents are fetched when not cached or gone stale.
 */
export async function resolveClient(
  clientId: string,
  s: LiveSettings,
): Promise<OAuthClient> {
  if (RESERVED_IDS.has(clientId))
    throw new OAuthError("invalid_client", "Orbyn doesn't know this app.", 401);
  const cimd = cimdUrl(clientId);
  const cached = (
    await pool.query<ClientRow>(
      `SELECT id, kind, name, host, redirect_uris, metadata, etag, fetched_at, blocked
         FROM oauth_clients WHERE id = $1`,
      [clientId],
    )
  ).rows[0];
  if (cimd) {
    // Checked before anything is fetched: a blocked or disallowed app costs nothing.
    if (s.agents.blocked_client_ids.includes(clientId) || cached?.blocked)
      throw new OAuthError(
        "unauthorized_client",
        "This app has been blocked by the administrator of this Orbyn.",
      );
    if (!hostAllowed(cimd.hostname, s.agents.allowed_client_hosts))
      throw new OAuthError(
        "unauthorized_client",
        `Apps from ${cimd.hostname} can't connect to this Orbyn.`,
      );
    const fresh = cached?.kind === "cimd" && freshRow(cached);
    const row = fresh ? cached : await fetchDocument(clientId, cached);
    usable(row, s);
    return toClient(row);
  }
  if (DCR_ID.test(clientId) && cached?.kind === "dcr") {
    usable(cached, s);
    return toClient(cached);
  }
  throw new OAuthError(
    "invalid_client",
    "Orbyn doesn't know this app. Its id must be the address of its client metadata document, or one Orbyn gave it when it registered.",
    401,
  );
}

/** How many apps one address may register a day, and in all per hour. */
export const DCR_LIMITS = { per_address_per_day: 20, per_hour: 500 };

/** A hash of an address, so none is ever stored. */
export const addressHash = (ip: string) =>
  createHash("sha256").update(`dcr|${ip}`).digest("base64url").slice(0, 32);

/**
 * Registers an app (RFC 7591). Only public clients: a request for a secret
 * method is registered as "none" (RFC 7591 lets the server replace asked-for
 * values) and answered without a secret. The application type is required
 * in effect: taken from the request, or from the redirect addresses when
 * missing ("native" for this computer and app schemes, "web" for https),
 * and the two must agree.
 */
export async function registerClient(
  db: Queryable,
  body: unknown,
  address: string,
): Promise<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new OAuthError(
      "invalid_client_metadata",
      "Send the app's metadata as a JSON object.",
    );
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10)
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uris must list between 1 and 10 addresses.",
    );
  if (!uris.every((u) => typeof u === "string" && validRedirectUri(u)))
    throw new OAuthError(
      "invalid_redirect_uri",
      "Each redirect address must be https, http back to this computer (localhost), or the app's own scheme, with no fragment.",
    );
  const redirects = uris as string[];
  const native = redirects.map((u) => !u.startsWith("https://"));
  const inferred = native.every(Boolean)
    ? "native"
    : native.some(Boolean)
      ? null
      : "web";
  const asked = b.application_type;
  if (asked !== undefined && asked !== "web" && asked !== "native")
    throw new OAuthError(
      "invalid_client_metadata",
      'application_type must be "web" or "native".',
    );
  const type = (asked as "web" | "native" | undefined) ?? inferred;
  if (
    !type ||
    (type === "web" && native.some(Boolean)) ||
    (type === "native" && !native.every(Boolean))
  )
    throw new OAuthError(
      "invalid_client_metadata",
      "A web app sends people back over https; a native app to this computer or its own scheme. Register one kind per app.",
    );
  // One app, one place to send people back to: every address on the same
  // website (or all back to this computer, or all to one app's scheme). An
  // app that lists another site beside its own could have a code sent there,
  // and Admin → Agents' allowed websites would name only one of them.
  if (new Set(redirects.map(redirectPlace)).size > 1)
    throw new OAuthError(
      "invalid_redirect_uri",
      "Every redirect address must be on the same website (or all back to this computer, or all to the app's own scheme). Register one app per website.",
    );
  const grants = b.grant_types ?? ["authorization_code"];
  if (
    !Array.isArray(grants) ||
    !grants.includes("authorization_code") ||
    !grants.every((g) => g === "authorization_code" || g === "refresh_token")
  )
    throw new OAuthError(
      "invalid_client_metadata",
      'grant_types may be "authorization_code" and "refresh_token".',
    );
  const responses = b.response_types ?? ["code"];
  if (!Array.isArray(responses) || responses.some((r) => r !== "code"))
    throw new OAuthError(
      "invalid_client_metadata",
      'response_types must be ["code"].',
    );
  if (b.jwks !== undefined || b.jwks_uri !== undefined)
    throw new OAuthError(
      "invalid_client_metadata",
      "Orbyn registers public apps only (PKCE, no keys).",
    );
  const firstHost = redirectHost(redirects[0]).host;
  const name = cleanName(b.client_name, firstHost || "An app");
  const id = `dcr_${randomBytes(24).toString("base64url")}`;
  const from = addressHash(address);
  const counts = (
    await db.query<{ mine: number; all: number }>(
      `SELECT count(*) FILTER (WHERE registered_from = $1 AND created_at > now() - interval '1 day')::int AS mine,
              count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS all
         FROM oauth_clients WHERE kind = 'dcr' AND created_at > now() - interval '1 day'`,
      [from],
    )
  ).rows[0];
  if (
    counts.mine >= DCR_LIMITS.per_address_per_day ||
    counts.all >= DCR_LIMITS.per_hour
  )
    throw new OAuthError(
      "temporarily_unavailable",
      "Too many apps registered from here today. Try again tomorrow, or use the app's client metadata document.",
      429,
    );
  const created = (
    await db.query<{ created_at: Date }>(
      `INSERT INTO oauth_clients (id, kind, name, host, redirect_uris, metadata, registered_from)
       VALUES ($1, 'dcr', $2, $3, $4, $5, $6) RETURNING created_at`,
      [
        id,
        name,
        firstHost,
        redirects,
        {
          application_type: type,
          grant_types: grants,
          client_uri:
            typeof b.client_uri === "string"
              ? b.client_uri.slice(0, 500)
              : null,
          software_id:
            typeof b.software_id === "string"
              ? b.software_id.slice(0, 200)
              : null,
          asked_auth_method:
            typeof b.token_endpoint_auth_method === "string"
              ? b.token_endpoint_auth_method.slice(0, 40)
              : null,
        },
        from,
      ],
    )
  ).rows[0];
  return {
    client_id: id,
    client_id_issued_at: Math.floor(created.created_at.getTime() / 1000),
    client_name: name,
    redirect_uris: redirects,
    grant_types: grants,
    response_types: ["code"],
    application_type: type,
    token_endpoint_auth_method: "none",
  };
}
