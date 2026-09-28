import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { deliverOne } = await import("../src/worker/delivery.js");
const { notifyAssistantAway } =
  await import("../src/modules/ai/agent/notices.js");
const userId = randomUUID();
const chatId = randomUUID();
let jobId: string;
before(async () => {
  await migrate();
  await pool.query(
    "INSERT INTO users(id, email, password_hash, name) VALUES($1, $2, 'test', 'Away tester')",
    [userId, `away-${userId}@example.test`],
  );
  await pool.query(
    "INSERT INTO ai_chats(id, user_id, title) VALUES($1, $2, 'Plan tomorrow')",
    [chatId, userId],
  );
  await pool.query("INSERT INTO devices(token, user_id) VALUES($1, $2)", [
    `ExponentPushToken[away-${userId}]`,
    userId,
  ]);
  jobId = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id, chat_id, state, created_at) VALUES($1, $2, 'running', now() - interval '1 minute') RETURNING id",
      [userId, chatId],
    )
  ).rows[0].id;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});
test("away transitions notify once per event and recently polled jobs stay quiet", async () => {
  await pool.query("UPDATE ai_jobs SET last_polled_at = now() WHERE id = $1", [
    jobId,
  ]);
  await notifyAssistantAway(pool, jobId, "done");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1",
        [userId],
      )
    ).rows[0].n,
    0,
  );
  await pool.query(
    "UPDATE ai_jobs SET last_polled_at = now() - interval '31 seconds' WHERE id = $1",
    [jobId],
  );
  await Promise.all([
    notifyAssistantAway(pool, jobId, "waiting", "question-one"),
    notifyAssistantAway(pool, jobId, "waiting", "question-one"),
  ]);
  await notifyAssistantAway(pool, jobId, "waiting", "question-two");
  await notifyAssistantAway(pool, jobId, "done");
  await notifyAssistantAway(pool, jobId, "failed");
  const rows = (
    await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY ref",
      [userId],
    )
  ).rows;
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.kind, "assistant");
    assert.ok(["inapp", "push"].includes(row.channel));
    assert.equal(row.state, row.channel === "inapp" ? "sent" : "pending");
    assert.equal(row.body, "Plan tomorrow");
    assert.ok(row.title.startsWith("Orbyn "));
    assert.ok(row.ref.startsWith(`chat:${chatId}:${jobId}:`));
  }
  await pool.query("UPDATE users SET disabled = true WHERE id = $1", [userId]);
  await notifyAssistantAway(pool, jobId, "waiting", "disabled-question");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1",
        [userId],
      )
    ).rows[0].n,
    8,
  );
});

test("the delivery worker sends a chat push without an item", async () => {
  await pool.query("UPDATE users SET disabled = false WHERE id = $1", [userId]);
  const notice = (
    await pool.query(
      "UPDATE notifications SET available_at = '1900-01-01' WHERE user_id = $1 AND channel = 'push' AND ref LIKE '%:done' RETURNING id",
      [userId],
    )
  ).rows[0];
  const original = globalThis.fetch;
  let payload: { data: { kind: string; ref: string } } | undefined;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://exp.host/--/api/v2/push/send");
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ data: { status: "ok", id: "away-ticket" } }),
    );
  };
  try {
    assert.equal(await deliverOne(), true);
    assert.equal(payload?.data.kind, "assistant");
    assert.ok(payload?.data.ref.startsWith(`chat:${chatId}:`));
    const saved = (
      await pool.query(
        "SELECT state, receipt_id FROM notifications WHERE id = $1",
        [notice.id],
      )
    ).rows[0];
    assert.equal(saved.state, "receipt");
    assert.equal(saved.receipt_id, "away-ticket");
  } finally {
    globalThis.fetch = original;
  }
});
