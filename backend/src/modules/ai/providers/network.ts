import { isIP } from "node:net";
import { fail } from "@orbyn/core";
import {
  outbound,
  ipv6Groups,
  type CheckedUrl,
} from "../../../lib/netguard.js";

/** Hostnames of cloud metadata services, which hold the server's own credentials. */
const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function blockedAddress(address: string) {
  const plain = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(plain) === 4) {
    const [a, b] = plain.split(".").map(Number);
    // Link-local (AWS, GCP, Azure metadata) and Alibaba's metadata address.
    return (a === 169 && b === 254) || plain === "100.100.100.200";
  }
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const zeros = (from: number, to: number) =>
    groups.slice(from, to).every((x) => x === 0);
  const embedded = (hi: number, lo: number) =>
    `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (
    (zeros(0, 5) && groups[5] === 0xffff) ||
    zeros(0, 6) ||
    (zeros(0, 4) && groups[4] === 0xffff && groups[5] === 0) ||
    (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6))
  )
    return blockedAddress(embedded(groups[6], groups[7]));
  if (groups[0] === 0x2002)
    return blockedAddress(embedded(groups[1], groups[2]));
  return (groups[0] & 0xffc0) === 0xfe80 || plain === "fd00:ec2::254";
}

/**
 * Whether a provider URL points at a machine of the user's own: loopback,
 * Docker's host alias, a bare container name, or a private network address.
 * Such models answer as fast as their hardware allows, so they get more time.
 */
export function isPrivateUrl(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "host.docker.internal") return true;
  if (!host.includes(".") && isIP(host) === 0) return true;
  if (/\.(local|internal|lan|home)$/.test(host)) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd");
}

/**
 * Provider URLs may point at local model servers (loopback or private
 * networks, for LM Studio or Ollama), but never at cloud metadata endpoints.
 * Checked when a provider is saved and again before every outbound call.
 */
export async function checkedProviderUrl(raw: string): Promise<CheckedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(422, "Base URL is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    fail(422, "Base URL must start with http:// or https://");
  if (url.username || url.password)
    fail(422, "Put credentials in the API key field, not in the URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host)) fail(422, "That address is not allowed.");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await outbound.lookup(host).catch(() => []);
  if (!addresses.length || addresses.some((a) => blockedAddress(a.address)))
    fail(422, "That address is not allowed or could not be resolved.");
  const first = addresses[0];
  return {
    url,
    pinned: { address: first.address, family: first.family === 6 ? 6 : 4 },
  };
}

export async function assertProviderUrl(raw: string) {
  await checkedProviderUrl(raw);
}
