import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 time-based one-time passwords, and RFC 4648 base32 for the shared
// secret, with no dependency: authenticator apps (Google Authenticator, Aegis,
// 1Password, …) all speak this.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

/** Encode bytes as unpadded base32. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode unpadded base32 (case-insensitive, spaces ignored). */
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 20-byte secret, base32-encoded for an authenticator app. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The 6-digit code for a secret at a given counter (default: now). */
function codeAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Whether `code` is valid for `secret` right now, allowing one step either
 * side so a code entered as it turns over still works. Constant-time.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now = Date.now(),
): boolean {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== DIGITS) return false;
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  for (let w = -1; w <= 1; w++) {
    const expected = codeAt(secret, counter + w);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app reads (from a QR or by hand). */
export function otpauthUri(
  secret: string,
  account: string,
  issuer = "Orbyn",
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** A one-time recovery code, like "4f3a-9k2p". */
export function recoveryCode(): string {
  const raw = base32Encode(randomBytes(5)).toLowerCase().slice(0, 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
