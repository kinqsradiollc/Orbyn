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
  await notifyAssistantAway(pool, jobId, "waiting", "recent-question");
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
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
    [jobId, JSON.stringify({ state: { waiting: { id: "question-one" } } })],
  );
  await Promise.all([
    notifyAssistantAway(pool, jobId, "waiting", "question-one"),
    notifyAssistantAway(pool, jobId, "waiting", "question-one"),
  ]);
  await pool.query("UPDATE ai_jobs SET run_state=$2 WHERE id=$1", [
    jobId,
    JSON.stringify({ state: { waiting: { id: "question-two" } } }),
  ]);
  await notifyAssistantAway(pool, jobId, "waiting", "question-two");
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [jobId]);
  await notifyAssistantAway(pool, jobId, "done");
  await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [jobId]);
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

test("the delivery worker sends a current terminal chat push without an item", async () => {
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [jobId]);
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

test("every automation kind stays out of personal notices after terminal checkpoints are cleared", async () => {
  const before = (
    await pool.query(
      "SELECT count(*)::int AS n FROM notifications WHERE user_id=$1",
      [userId],
    )
  ).rows[0].n;
  for (const origin of ["idea", "goal", "routine", "task", "night"]) {
    const id = (
      await pool.query(
        "INSERT INTO ai_jobs(user_id,chat_id,state,run_origin,created_at) VALUES($1,$2,'done',$3,now()-interval '1 minute') RETURNING id",
        [userId, chatId, origin],
      )
    ).rows[0].id;
    await notifyAssistantAway(pool, id, "done");
    await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [id]);
    await notifyAssistantAway(pool, id, "failed");
    await pool.query(
      "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
      [id, JSON.stringify({ state: { waiting: { id: "automation-card" } } })],
    );
    await notifyAssistantAway(pool, id, "waiting", "automation-card");
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM notifications WHERE user_id=$1",
        [userId],
      )
    ).rows[0].n,
    before,
  );
});

test("a quick unseen result is reconsidered after the grace period and a seen result stays quiet", async () => {
  const { flushAssistantAwayNotices } =
    await import("../src/modules/ai/agent/notices.js");
  for (const seen of [false, true]) {
    const id = (
      await pool.query(
        "INSERT INTO ai_jobs(user_id,chat_id,state,created_at) VALUES($1,$2,'done',now()-interval '5 seconds') RETURNING id",
        [userId, chatId],
      )
    ).rows[0].id;
    await notifyAssistantAway(pool, id, "done");
    const count = async () =>
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM notifications WHERE ref=$1",
          [`chat:${chatId}:${id}:done`],
        )
      ).rows[0].n;
    assert.equal(await count(), 0);
    if (seen)
      await pool.query("UPDATE ai_jobs SET last_polled_at=now() WHERE id=$1", [
        id,
      ]);
    await pool.query(
      "UPDATE ai_jobs SET created_at=now()-interval '31 seconds' WHERE id=$1",
      [id],
    );
    await flushAssistantAwayNotices();
    assert.equal(await count(), seen ? 0 : 2);
    await flushAssistantAwayNotices();
    assert.equal(await count(), seen ? 0 : 2);
  }
});

test("queued waiting pushes are stale after another device answers or the displayed card changes", async () => {
  const { assistantNoticeStale } = await import("../src/worker/delivery.js");
  const { transaction } = await import("../src/db/pool.js");
  const card = randomUUID();
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',run_state=$2 WHERE id=$1",
    [jobId, JSON.stringify({ state: { waiting: { id: card } } })],
  );
  const notice = {
    user_id: userId,
    ref: `chat:${chatId}:${jobId}:waiting:${card}`,
  };
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notice)),
    false,
  );
  await pool.query("UPDATE ai_jobs SET run_state=$2 WHERE id=$1", [
    jobId,
    JSON.stringify({ state: { waiting: { id: randomUUID() } } }),
  ]);
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notice)),
    true,
  );
  await pool.query("UPDATE ai_jobs SET state='queued' WHERE id=$1", [jobId]);
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notice)),
    true,
  );
});

test("assistant inbox and delivery suppress a project after it is kept out of AI", async () => {
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [jobId]);
  const { assistantNoticeStale } = await import("../src/worker/delivery.js");
  const { listNotifications } =
    await import("../src/modules/notifications/service.js");
  const { transaction } = await import("../src/db/pool.js");
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Restricted source') RETURNING id",
      [userId],
    )
  ).rows[0].id;
  await pool.query("UPDATE ai_chats SET project_id=$2 WHERE id=$1", [
    chatId,
    project,
  ]);
  const notice = { user_id: userId, ref: `chat:${chatId}:${jobId}:done` };
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notice)),
    false,
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  assert.equal(
    await transaction((db) => assistantNoticeStale(db, notice)),
    true,
  );
  assert.equal(
    (await listNotifications(pool, userId)).filter((n) =>
      n.ref?.startsWith(`chat:${chatId}:`),
    ).length,
    0,
  );
  await pool.query("UPDATE ai_chats SET project_id=NULL WHERE id=$1", [chatId]);
});

test("obsolete terminal pushes are cancelled before delivery", async () => {
  const { assistantNoticeStale } = await import("../src/worker/delivery.js");
  const { transaction } = await import("../src/db/pool.js");
  await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [jobId]);
  assert.equal(
    await transaction((db) =>
      assistantNoticeStale(db, {
        user_id: userId,
        ref: `chat:${chatId}:${jobId}:done`,
      }),
    ),
    true,
  );
  assert.equal(
    await transaction((db) =>
      assistantNoticeStale(db, {
        user_id: userId,
        ref: `chat:${chatId}:${jobId}:failed`,
      }),
    ),
    false,
  );
});

test("legacy human replies in a reminder chat migrate as personal runs", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = (
    await readFile(
      new URL(
        "../migrations/193_assistant_notice_lifecycle.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).split("CREATE TABLE assistant_notice_events")[0];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "CREATE TEMP TABLE ai_chats (id uuid, user_id uuid, title text, origin text)",
    );
    await db.query(
      "CREATE TEMP TABLE ai_jobs (id uuid, user_id uuid, chat_id uuid, state text, run_state jsonb)",
    );
    // Recreate the pre-193 inputs, not today's schema: later ownership columns
    // rely on insert triggers which CREATE TABLE LIKE does not copy.
    const chat = randomUUID(),
      job = randomUUID();
    await db.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Reminder follow-up','reminders')",
      [chat, userId],
    );
    await db.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_state) VALUES($1,$2,$3,'done',NULL)",
      [job, userId, chat],
    );
    await db.query(sql);
    assert.equal(
      (await db.query("SELECT run_origin FROM ai_jobs WHERE id=$1", [job]))
        .rows[0].run_origin,
      "person",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
