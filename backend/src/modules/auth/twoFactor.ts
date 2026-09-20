import { fail } from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { decryptSecret } from "../../lib/secrets.js";
import { verifyTotp } from "../../lib/totp.js";

export const TOTP_REQUIRED = "totp_required";

type TotpRow = { secret_encrypted: string; recovery_hashes: string[] };

/** The user's confirmed two-step row, or null when it's off. */
export async function confirmedTotp(
  db: Db,
  userId: string,
): Promise<TotpRow | null> {
  return (
    (
      await db.query<TotpRow>(
        "SELECT secret_encrypted, recovery_hashes FROM user_totp WHERE user_id=$1 AND confirmed_at IS NOT NULL",
        [userId],
      )
    ).rows[0] ?? null
  );
}

export async function twoFactorOn(db: Db, userId: string): Promise<boolean> {
  return !!(await confirmedTotp(db, userId));
}

/**
 * Enforce two-step at sign-in. Does nothing when it's off. Otherwise the code
 * must be a current TOTP or an unused recovery code (which is then spent).
 * Fails with TOTP_REQUIRED when no code was given, so the client knows to ask.
 */
export async function enforceTwoFactor(
  userId: string,
  code: string | undefined,
) {
  const row = await confirmedTotp(pool, userId);
  if (!row) return;
  if (!code) fail(401, TOTP_REQUIRED);
  const secret = await decryptSecret(row.secret_encrypted);
  if (verifyTotp(secret, code)) return;
  // Not a live code: try the recovery codes, spending the one that matches.
  const hash = digest(code.trim().toLowerCase());
  if (row.recovery_hashes.includes(hash)) {
    await pool.query(
      "UPDATE user_totp SET recovery_hashes = array_remove(recovery_hashes, $2) WHERE user_id=$1",
      [userId, hash],
    );
    return;
  }
  fail(401, "That code didn't work. Try again.");
}
