import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fail } from "@orbyn/core";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";

/**
 * Encryption for credentials stored in the database (AI provider API keys),
 * using AES-256-GCM with a random 96-bit nonce per value.
 *
 * Nothing has to be configured: without SECRETS_KEY, Orbyn creates a random
 * key once and keeps it in the `app_secrets` table, shared by every instance.
 * Setting SECRETS_KEY (32 random bytes, base64) keeps the key outside the
 * database, which protects saved credentials even if a database dump leaks.
 * Values record which key encrypted them, so both keep working:
 *   v1:<nonce>:<tag>:<ciphertext>   encrypted with SECRETS_KEY
 *   d1:<nonce>:<tag>:<ciphertext>   encrypted with the database key
 */
const WITH_SECRETS_KEY = "v1";
const WITH_DATABASE_KEY = "d1";

function secretsKey(): Buffer {
  const raw = Buffer.from(env.SECRETS_KEY, "base64");
  if (raw.length !== 32)
    fail(503, "SECRETS_KEY must be 32 random bytes, base64 encoded.");
  return raw;
}

let databaseKeyPromise: Promise<Buffer> | null = null;

/** The server-generated key, created on first use. Safe with many instances. */
function databaseKey(): Promise<Buffer> {
  databaseKeyPromise ??= (async () => {
    await pool.query(
      "INSERT INTO app_secrets(name, value) VALUES ('credentials_key', $1) ON CONFLICT (name) DO NOTHING",
      [randomBytes(32).toString("base64")],
    );
    const { rows } = await pool.query<{ value: string }>(
      "SELECT value FROM app_secrets WHERE name = 'credentials_key'",
    );
    return Buffer.from(rows[0].value, "base64");
  })().catch((error) => {
    databaseKeyPromise = null;
    throw error;
  });
  return databaseKeyPromise;
}

export async function encryptSecret(plain: string): Promise<string> {
  const version = env.SECRETS_KEY ? WITH_SECRETS_KEY : WITH_DATABASE_KEY;
  const key = env.SECRETS_KEY ? secretsKey() : await databaseKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    version,
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export async function decryptSecret(stored: string): Promise<string> {
  const [version, nonce, tag, data] = stored.split(":");
  if (!nonce || !tag || data === undefined)
    throw new Error("Unrecognised secret format");
  let key: Buffer;
  if (version === WITH_DATABASE_KEY) key = await databaseKey();
  else if (version === WITH_SECRETS_KEY) {
    if (!env.SECRETS_KEY)
      fail(
        503,
        "This API key was saved while SECRETS_KEY was set. Restore SECRETS_KEY or re-enter the key in Admin → AI.",
      );
    key = secretsKey();
  } else throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
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
