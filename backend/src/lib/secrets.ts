import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fail } from "@orbyn/core";
import { env } from "../config/env.js";

/**
 * Encryption for credentials stored in the database (AI provider API keys).
 * AES-256-GCM with a random 96-bit nonce per value; the 32-byte key comes from
 * SECRETS_KEY and never touches the database. Stored format:
 *   v1:<nonce b64url>:<auth tag b64url>:<ciphertext b64url>
 */
const VERSION = "v1";

function key(): Buffer {
  if (!env.SECRETS_KEY)
    fail(
      503,
      "Credential storage is not configured. Set SECRETS_KEY on the server (see docs/setup.md).",
    );
  const raw = Buffer.from(env.SECRETS_KEY, "base64");
  if (raw.length !== 32)
    fail(503, "SECRETS_KEY must be 32 random bytes, base64 encoded.");
  return raw;
}

export const secretsConfigured = () => {
  try {
    key();
    return true;
  } catch {
    return false;
  }
};

export function encryptSecret(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, nonce, tag, data] = stored.split(":");
  if (version !== VERSION || !nonce || !tag || data === undefined)
    throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(nonce, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** What clients see instead of a key: the first few and last four characters. */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 8) return "••••";
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
