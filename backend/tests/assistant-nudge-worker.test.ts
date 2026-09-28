import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { DEFAULT_REMINDER_NUDGES } from "@orbyn/core";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { postReminderNudge, reminderNudgeCandidates } =
  await import("../src/worker/reminder-nudges.js");
const { reminderNudgeStale } = await import("../src/worker/delivery.js");
const people: string[] = [];
const now = new Date("2050-01-02T15:00:00Z");
before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [people]);
  await pool.end();
});
async function person(chat = true) {
  const id = randomUUID();
  people.push(id);
  await pool.query(
    "INSERT INTO users(id, email, password_hash, name) VALUES($1, $2, 'test', 'Nudge tester')",
    [id, `nudge-${id}@example.test`],
  );
  await assistantPrincipal({ id, name: "Nudge tester", role: "member" });
  await pool.query(
    "INSERT INTO agent_settings(user_id, reminder_nudges) VALUES($1, $2)",
    [id, JSON.stringify({ ...DEFAULT_REMINDER_NUDGES, chat })],
  );
  const tasks: string[] = [];
  for (let n = 0; n < 4; n++)
    tasks.push(
      (
        await pool.query(
          "INSERT INTO items(user_id, title, due_at) VALUES($1, $2, $3) RETURNING id",
          [id, `Overdue ${n}`, new Date("2049-12-30T12:00:00Z")],
        )
      ).rows[0].id,
    );
  return { id, tasks };
}
test("concurrent senders reserve at most three per local day and keep one pinned personal chat", async () => {
  const me = await person();
  const candidates = await reminderNudgeCandidates(me.id, "UTC", now);
  for (let attempt = 0; attempt < 3; attempt++)
    await Promise.all(
      candidates.map((c) => postReminderNudge(me.id, "UTC", c, now)),
    );
  for (const candidate of candidates)
    await postReminderNudge(me.id, "UTC", candidate, now);
  const rows = (
    await pool.query("SELECT * FROM assistant_nudges WHERE user_id = $1", [
      me.id,
    ])
  ).rows;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.nudge_key)).size, 3);
  const chats = (
    await pool.query(
      "SELECT * FROM ai_chats WHERE user_id = $1 AND origin = 'reminders'",
      [me.id],
    )
  ).rows;
  assert.equal(chats.length, 1);
  assert.equal(chats[0].pinned, true);
  assert.equal(chats[0].turns.length, 3);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND channel = 'email'",
        [me.id],
      )
    ).rows[0].count,
    3,
  );
});
test("chat-off delivery resolves the ledger and cancels completed or stopped sources", async () => {
  const me = await person(false);
  const candidate = (await reminderNudgeCandidates(me.id, "UTC", now))[0];
  assert.equal(await postReminderNudge(me.id, "UTC", candidate, now), true);
  const ledger = (
    await pool.query("SELECT * FROM assistant_nudges WHERE user_id = $1", [
      me.id,
    ])
  ).rows[0];
  const notice = {
    user_id: me.id,
    ref: `nudge:${ledger.id}`,
    channel: "email",
  };
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM ai_chats WHERE user_id = $1",
        [me.id],
      )
    ).rows[0].count,
    0,
  );
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [
    candidate.entity_id,
  ]);
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    true,
  );
  await pool.query("UPDATE items SET status = 'todo' WHERE id = $1", [
    candidate.entity_id,
  ]);
  await pool.query("UPDATE assistant_nudges SET stopped = true WHERE id = $1", [
    ledger.id,
  ]);
  assert.equal(
    await transaction((db) => reminderNudgeStale(db, notice, now)),
    true,
  );
});
test("posting rechecks ownership, completion and kept-out projects after selection", async () => {
  const me = await person();
  const other = await person();
  const candidates = await reminderNudgeCandidates(me.id, "UTC", now);
  assert.equal(
    await postReminderNudge(other.id, "UTC", candidates[0], now),
    false,
  );
  await pool.query("UPDATE items SET status = 'done' WHERE id = $1", [
    candidates[0].entity_id,
  ]);
  assert.equal(
    await postReminderNudge(me.id, "UTC", candidates[0], now),
    false,
  );
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id, name, assistant_off) VALUES($1, 'Kept out', true) RETURNING id",
      [me.id],
    )
  ).rows[0].id;
  await pool.query("UPDATE items SET project_id = $2 WHERE id = $1", [
    candidates[1].entity_id,
    project,
  ]);
  assert.equal(
    await postReminderNudge(me.id, "UTC", candidates[1], now),
    false,
  );
});
test("the same thing is deduplicated when its reminder category changes", async () => {
  const me = await person();
  const candidate = (await reminderNudgeCandidates(me.id, "UTC", now))[0];
  assert.equal(await postReminderNudge(me.id, "UTC", candidate, now), true);
  await pool.query("UPDATE items SET due_at = $2 WHERE id = $1", [
    candidate.entity_id,
    new Date("2050-01-02T17:00:00Z"),
  ]);
  const changed = (await reminderNudgeCandidates(me.id, "UTC", now)).find(
    (c) => c.entity_id === candidate.entity_id,
  )!;
  assert.equal(changed.category, "due");
  assert.equal(changed.key, candidate.key);
  assert.equal(await postReminderNudge(me.id, "UTC", changed, now), false);
});
