import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { fail } from "@orbyn/core";
import { env } from "../config/env.js";

/**
 * Webhooks and calendar links make this server call addresses its users
 * choose. To keep that from reaching the database, the gateway or anything
 * else inside the network, such an address must be https and resolve to
 * public addresses only. It is checked again before every call, and the call
 * then connects to the very address that was checked, so a name can't answer
 * "public" to the check and "private" to the connection (DNS rebinding).
 * ALLOW_PRIVATE_WEBHOOKS (local development only) lifts all of this.
 */
function privateIPv4(ip: string) {
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** An IPv6 address as eight 16-bit groups, or null when it isn't one. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().replace(/%.*$/, "");
  // A dotted IPv4 tail ("::ffff:127.0.0.1") becomes two hex groups.
  const tail = v.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (isIP(tail[2]) !== 4) return null;
    const [a, b, c, d] = tail[2].split(".").map(Number);
    v = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const part = (s: string) => (s ? s.split(":") : []);
  const head = part(halves[0]);
  const rest = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...rest];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** The IPv4 address held in two 16-bit groups. */
const v4 = (hi: number, lo: number) =>
  `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function privateIPv6(ip: string) {
  const g = ipv6Groups(ip);
  if (!g) return true; // Unreadable: never call it.
  const zeros = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  // :: and ::1.
  if (zeros(0, 7) && g[7] <= 1) return true;
  // IPv4 inside IPv6, however it's written ([::ffff:7f00:1] is 127.0.0.1):
  // mapped ::ffff:a.b.c.d, translated ::ffff:0:a.b.c.d, the old compatible
  // ::a.b.c.d, and NAT64 64:ff9b::a.b.c.d and 64:ff9b:1::/48.
  if (zeros(0, 5) && g[5] === 0xffff) return privateIPv4(v4(g[6], g[7]));
  if (zeros(0, 4) && g[4] === 0xffff && g[5] === 0)
    return privateIPv4(v4(g[6], g[7]));
  if (zeros(0, 6)) return privateIPv4(v4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6))
    return privateIPv4(v4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // 6to4 carries an IPv4 address in its second and third groups.
  if (g[0] === 0x2002) return privateIPv4(v4(g[1], g[2]));
  // Teredo tunnels, discard-only, and documentation addresses.
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true;
  if (g[0] === 0x100 && zeros(1, 4)) return true;
  // Unique local fc00::/7, link-local fe80::/10, site-local fec0::/10,
  // multicast ff00::/8.
  return (
    (g[0] & 0xfe00) === 0xfc00 ||
    (g[0] & 0xffc0) === 0xfe80 ||
    (g[0] & 0xffc0) === 0xfec0 ||
    (g[0] & 0xff00) === 0xff00
  );
}

export const isPrivateAddress = (ip: string) =>
  isIP(ip) === 4 ? privateIPv4(ip) : privateIPv6(ip);

const WORDING = {
  webhook: {
    scheme: "Webhook URLs start with https://",
    private: "Webhooks must call a public address, not a private network.",
  },
  calendar: {
    scheme: "Calendar links start with https://",
    private:
      "Calendar links must be on a public address, not a private network.",
  },
};

export type UrlKind = keyof typeof WORDING;

/** A checked address to call, and the one IP address to connect to. */
export type CheckedUrl = {
  url: URL;
  /** Null only with ALLOW_PRIVATE_WEBHOOKS, when the name resolves as usual. */
  pinned: { address: string; family: 4 | 6 } | null;
};

/**
 * Check that `raw` may be called: an https URL whose name resolves only to
 * public addresses. Fails with 422 in words people can act on.
 */
export async function checkPublicUrl(
  raw: string,
  kind: UrlKind = "webhook",
): Promise<CheckedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(422, "That isn't a valid URL.");
  }
  const privateAllowed = env.ALLOW_PRIVATE_WEBHOOKS === "true";
  if (
    url.protocol !== "https:" &&
    !(privateAllowed && url.protocol === "http:")
  )
    fail(422, WORDING[kind].scheme);
  if (privateAllowed) return { url, pinned: null };
  // The URL parser has already turned 2130706433, 0x7f.1 and friends into
  // 127.0.0.1, and IPv6 into its short hex form ([::ffff:7f00:1]).
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: number }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
  } catch {
    fail(422, `Couldn't find ${host}. Check the address.`);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
    fail(422, WORDING[kind].private);
  const first = addresses[0];
  return {
    url,
    pinned: { address: first.address, family: first.family === 6 ? 6 : 4 },
  };
}

/**
 * Fails with 422 unless `raw` is an https URL on a public address. Used to
 * check webhooks and calendar links when they're saved; calls go through
 * publicFetch, which checks again.
 */
export async function assertPublicUrl(
  raw: string,
  kind: UrlKind = "webhook",
): Promise<URL> {
  return (await checkPublicUrl(raw, kind)).url;
}

/** Statuses whose responses never have a body. */
const NO_BODY = new Set([101, 204, 205, 304]);

export type PublicFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

/**
 * The HTTP call itself: connects to the pinned address (when there is one)
 * while sending the real host name, so TLS still checks the certificate for
 * it. Redirects are never followed; the caller checks each hop. Kept on an
 * object so tests can stand in for the network.
 */
export const outbound = {
  request(checked: CheckedUrl, init: PublicFetchInit = {}): Promise<Response> {
    const { url, pinned } = checked;
    // Node asks for every address when it may try several (autoSelectFamily).
    const lookupPinned: LookupFunction | undefined = pinned
      ? (_host, options, callback) =>
          options.all
            ? callback(null, [pinned])
            : callback(null, pinned.address, pinned.family)
      : undefined;
    return new Promise<Response>((resolve, reject) => {
      const { signal } = init;
      if (signal?.aborted) return reject(signal.reason);
      const request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method: init.method ?? "GET",
          headers: {
            ...init.headers,
            ...(init.body !== undefined
              ? { "Content-Length": String(Buffer.byteLength(init.body)) }
              : {}),
          },
          ...(lookupPinned ? { lookup: lookupPinned } : {}),
          ...(signal ? { signal } : {}),
        },
        (res) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (Array.isArray(value))
              for (const v of value) headers.append(name, v);
            else if (value !== undefined) headers.set(name, value);
          }
          const status = res.statusCode ?? 0;
          if (status < 200 || status > 599) {
            res.destroy();
            return reject(new Error(`Unexpected HTTP status ${status}`));
          }
          const empty = NO_BODY.has(status) || init.method === "HEAD";
          if (empty) res.resume();
          resolve(
            new Response(
              empty ? null : (Readable.toWeb(res) as ReadableStream),
              { status, statusText: res.statusMessage, headers },
            ),
          );
        },
      );
      // A timed-out signal rejects with its TimeoutError, as fetch() does.
      request.on("error", (error) =>
        reject(signal?.aborted ? signal.reason : error),
      );
      if (init.body !== undefined) request.write(init.body);
      request.end();
    });
  },
};

/**
 * fetch() for an address a user chose: checked (https, public addresses
 * only) and then called at the checked address. Redirects come back as they
 * are, for the caller to check and follow.
 */
export async function publicFetch(
  raw: string,
  init: PublicFetchInit = {},
  kind: UrlKind = "webhook",
): Promise<Response> {
  return outbound.request(await checkPublicUrl(raw, kind), init);
}
