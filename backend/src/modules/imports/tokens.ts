import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

/**
 * Signed links for the file store. The API hands the app an upload link for
 * one import; the file store checks the signature and the expiry, and that
 * the import is still waiting for its file, so each link works once. The
 * converter proves itself to the file store with a key derived from the
 * same secret. Nothing here is stored: the signature is the permission.
 */

export type UploadClaim = {
  /** The import this upload is for. */
  i: string;
  /** Its owner. */
  u: string;
  /** Expiry, epoch seconds. */
  e: number;
  /** Largest body accepted, in bytes. */
  m: number;
  /** The type the file must turn out to be. */
  t: string;
};

const key = (purpose: string) =>
  createHmac("sha256", env.FILES_SECRET).update(purpose).digest();

const sign = (payload: string) =>
  createHmac("sha256", key("upload")).update(payload).digest("base64url");

/** Whether importing is set up on this server. */
export const importsEnabled = () => env.FILES_SECRET.length >= 16;

export function uploadToken(claim: UploadClaim): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The claim in an upload link, or null when it's forged or expired. */
export function readUploadToken(
  token: string,
  now = Date.now(),
): UploadClaim | null {
  if (!importsEnabled()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claim = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as UploadClaim;
    return claim.e * 1000 > now ? claim : null;
  } catch {
    return null;
  }
}

/** The header the converter sends to read and delete stored files. */
export const serviceKey = () => key("service").toString("base64url");

export function isService(header: string | string[] | undefined): boolean {
  if (!importsEnabled() || typeof header !== "string") return false;
  const expected = Buffer.from(serviceKey());
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ------------------------------------------------ pictures and files ---

/**
 * A signed claim for one purpose: pictures and files in pages use their
 * own purposes, so an import's upload link can't be used for a page's file
 * (or a link to read a file for anything else), and the other way round.
 */
function signFor(purpose: string, payload: string) {
  return createHmac("sha256", key(purpose)).update(payload).digest("base64url");
}

export function claimToken<T extends { e: number }>(
  purpose: "page-upload" | "page-read",
  claim: T,
): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${signFor(purpose, payload)}`;
}

/** The claim in a signed link for `purpose`, or null when forged or expired. */
export function readClaimToken<T extends { e: number }>(
  purpose: "page-upload" | "page-read",
  token: string,
  now = Date.now(),
): T | null {
  if (!importsEnabled()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(signFor(purpose, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const claim = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as T;
    return claim.e * 1000 > now ? claim : null;
  } catch {
    return null;
  }
}
