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
 * Only public clients are served (token_endpoint_auth_method "none", with
 * PKCE): there are no client secrets to leak or rotate.
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

type ClientRow = {
  id: string;
  kind: "cimd" | "dcr";
  name: string;
  host: string;
  redirect_uris: string[];
  metadata: { cache_seconds?: number } & Record<string, unknown>;
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
  const method = doc.token_endpoint_auth_method;
  if (method !== undefined && method !== "none")
    throw new OAuthError(
      "invalid_client",
      "This app signs in with a method Orbyn doesn't support (only public apps with PKCE).",
    );
  const grants = doc.grant_types;
  if (
    grants !== undefined &&
    (!Array.isArray(grants) || !grants.includes("authorization_code"))
  )
    throw new OAuthError(
      "invalid_client",
      "This app doesn't use sign-in codes.",
    );
  const host = new URL(url).hostname;
  return {
    name: cleanName(doc.client_name, host),
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
async function fetchDocument(
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
    const fresh =
      cached?.kind === "cimd" &&
      cached.fetched_at &&
      Date.now() - cached.fetched_at.getTime() <
        (cached.metadata?.cache_seconds ?? 3600) * 1000;
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
