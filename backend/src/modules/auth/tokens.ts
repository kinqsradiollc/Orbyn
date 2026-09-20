import { randomBytes } from "node:crypto";
import type { Db } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";

/** How long a link stays good, by purpose. */
const TTL_MINUTES = { verify: 24 * 60, reset: 60 } as const;
export type TokenPurpose = keyof typeof TTL_MINUTES;

/**
 * Issue a single-use link token for `userId`. Only its hash is stored, so a
 * leak of the database can't be turned back into a working link. Any earlier
 * token of the same purpose is dropped, so only the newest link works.
 */
export async function issueToken(
  db: Db,
  userId: string,
  purpose: TokenPurpose,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query("DELETE FROM email_tokens WHERE user_id=$1 AND purpose=$2", [
    userId,
    purpose,
  ]);
  await db.query(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [digest(token), userId, purpose, String(TTL_MINUTES[purpose])],
  );
  return token;
}

/**
 * Spend a token: return its user id and delete it, or null when it is unknown,
 * expired or of the wrong purpose. Single-use — a spent token never works
 * again, even within its lifetime.
 */
export async function spendToken(
  db: Db,
  token: string,
  purpose: TokenPurpose,
): Promise<string | null> {
  const row = (
    await db.query<{ user_id: string }>(
      `DELETE FROM email_tokens
         WHERE token_hash=$1 AND purpose=$2 AND expires_at > now()
         RETURNING user_id`,
      [digest(token), purpose],
    )
  ).rows[0];
  return row?.user_id ?? null;
}

/** Remove expired links; called opportunistically when new ones are issued. */
export async function pruneExpiredTokens() {
  await pool
    .query("DELETE FROM email_tokens WHERE expires_at < now()")
    .catch(() => {});
}
