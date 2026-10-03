import "./setup.js";
import assert from "node:assert/strict";
const { pool } = await import("../src/db/pool.js");
import type { UserRow } from "../src/lib/auth.js";
const { digest, issueSession } = await import("../src/lib/auth.js");

/** Start a rate-window fixture without inheriting earlier calls from its device. */
export async function freshRateLimitSession(token: string): Promise<string> {
  const user = (
    await pool.query<UserRow>(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  ).rows[0];
  assert.ok(user, "The rate-limit fixture must start from a live session");
  return (await issueSession(user, "Rate-limit fixture device")).token;
}
