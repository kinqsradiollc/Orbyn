import "./setup.js";
import assert from "node:assert/strict";
import type { UserRow } from "../src/lib/auth.js";

/** Start a rate-window fixture without inheriting earlier calls from its device. */
export async function freshRateLimitSession(token: string): Promise<string> {
  const { pool } = await import("../src/db/pool.js");
  const { digest, issueSession } = await import("../src/lib/auth.js");
  const user = (
    await pool.query<UserRow & { session_verified_at: Date | null }>(
      "SELECT u.*,s.reauthenticated_at AS session_verified_at FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  assert.ok(user, "The rate-limit fixture must start from a live session");
  const issued = await issueSession(user, "Rate-limit fixture device");
  // Retain the prior proof time rather than accidentally strengthening write authority.
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=$2 WHERE token_hash=$1",
    [digest(issued.token), user.session_verified_at],
  );
  return issued.token;
}
