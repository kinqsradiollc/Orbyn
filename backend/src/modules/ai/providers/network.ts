import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { fail } from "@orbyn/core";

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
  return plain.startsWith("fe80:") || plain === "fd00:ec2::254";
}

/**
 * Provider URLs may point at local model servers (loopback or private
 * networks, for LM Studio or Ollama), but never at cloud metadata endpoints.
 * Checked when a provider is saved and again before every outbound call.
 */
export async function assertProviderUrl(raw: string) {
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
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.some(blockedAddress)) fail(422, "That address is not allowed.");
}
