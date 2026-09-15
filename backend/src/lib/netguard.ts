import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fail } from "@orbyn/core";
import { env } from "../config/env.js";

/**
 * Webhooks make this server call addresses its users choose. To keep that from
 * reaching the database, the gateway or anything else inside the network, a
 * webhook must resolve to public addresses only (checked again before every
 * delivery, in case the name now resolves elsewhere).
 */
function privateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateIPv6(ip: string) {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIPv4(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
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

/**
 * Fails with 422 unless `raw` is an http(s) URL on a public address. Used for
 * webhooks and for calendars subscribed to by link.
 */
export async function assertPublicUrl(
  raw: string,
  kind: keyof typeof WORDING = "webhook",
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(422, "That isn't a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    fail(422, WORDING[kind].scheme);
  if (env.ALLOW_PRIVATE_WEBHOOKS === "true") return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    fail(422, `Couldn't find ${host}. Check the address.`);
  }
  if (!addresses.length || addresses.some(isPrivateAddress))
    fail(422, WORDING[kind].private);
  return url;
}
