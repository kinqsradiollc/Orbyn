import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/db/pool.js";
import { readCompletedChatgptUsage } from "../src/modules/auth/chatgpt-usage.js";

test("usage query keeps PostgreSQL microseconds at both window boundaries", async () => {
  const original = pool.connect;
  const since = "2026-09-05 12:00:00.123456+00";
  const until = "2026-10-05 12:00:00.123456+00";
  const owner = randomUUID(),
    session = randomUUID();
  let eligible = false,
    released = false;
  pool.connect = (async () => ({
    query: async (sql: string, args?: unknown[]) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql))
        return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT disabled,email_verified"))
        return {
          rows: [{ disabled: false, email_verified: true }],
          rowCount: 1,
        };
      if (sql.startsWith("SELECT id FROM sessions"))
        return { rows: [{ id: session }], rowCount: 1 };
      if (sql.startsWith("SELECT analytics_opt_out"))
        return { rows: [{ analytics_opt_out: false }], rowCount: 1 };
      if (sql.startsWith("SELECT now()")) {
        assert.ok(sql.includes("now()::text AS until_sql"));
        return {
          rows: [
            {
              since: new Date(since),
              until: new Date(until),
              since_sql: since,
              until_sql: until,
            },
          ],
        };
      }
      if (sql.includes("WITH eligible")) {
        assert.deepEqual(args, [owner, since, until, true]);
        eligible = true;
        return {
          rows: [
            {
              completed_requests: "1",
              measured_requests: "1",
              input_tokens: "1",
              output_tokens: "2",
              total_tokens: "3",
              recent: [],
            },
          ],
        };
      }
      throw new Error(`Unexpected usage query: ${sql}`);
    },
    release: () => {
      released = true;
    },
  })) as typeof pool.connect;
  try {
    const result = await readCompletedChatgptUsage({
      userId: owner,
      sessionId: session,
    });
    assert.equal(result.completed_requests, 1);
    assert.equal(result.total_tokens, "3");
    assert.equal(eligible, true);
    assert.equal(released, true);
  } finally {
    pool.connect = original;
  }
});
