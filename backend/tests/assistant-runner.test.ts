import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { claimAssistantJob } = await import("../src/modules/ai/agent/runner.js");
const { initialAssistantRun } = await import("../src/modules/ai/agent/run.js");
let userId: string;
before(async () => {
  await migrate();
  userId = (
    await pool.query(
      "INSERT INTO users(email, password_hash, name) VALUES($1, 'test', 'Runner test') RETURNING id",
      [`runner-${randomUUID()}@example.test`],
    )
  ).rows[0].id;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});
async function enqueue() {
  const chatId = (
    await pool.query(
      "INSERT INTO ai_chats(id, user_id, title) VALUES(gen_random_uuid(), $1, 'Runner test') RETURNING id",
      [userId],
    )
  ).rows[0].id;
  const request = {
    chat_id: chatId,
    turn_id: randomUUID(),
    message: "Plan tomorrow",
    timezone: "UTC",
    history: [],
    scope: null,
  };
  return (
    await pool.query(
      "INSERT INTO ai_jobs(user_id, chat_id, turn_id, state, run_state) VALUES($1, $2, $3, 'queued', $4::jsonb) RETURNING id",
      [
        userId,
        chatId,
        request.turn_id,
        JSON.stringify(initialAssistantRun(request)),
      ],
    )
  ).rows[0].id as string;
}
test("two runner copies claim a queued job exactly once with a sixty-second lease", async () => {
  const id = await enqueue();
  const claims = await Promise.all([
    claimAssistantJob("runner-a"),
    claimAssistantJob("runner-b"),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean)?.id, id);
  const job = (
    await pool.query(
      "SELECT state, claimed_by, lease_until > now() + interval '55 seconds' AS leased FROM ai_jobs WHERE id = $1",
      [id],
    )
  ).rows[0];
  assert.equal(job.state, "running");
  assert.ok(["runner-a", "runner-b"].includes(job.claimed_by));
  assert.equal(job.leased, true);
  assert.equal(await claimAssistantJob("runner-c"), null);
});
test("parked questions and finished jobs are never claimed as new work", async () => {
  const id = await enqueue();
  for (const state of ["waiting", "done", "failed"]) {
    await pool.query("UPDATE ai_jobs SET state = $2 WHERE id = $1", [
      id,
      state,
    ]);
    assert.equal(await claimAssistantJob("runner-a"), null);
  }
});

test("Stop discards a queued run before a worker can claim it", async () => {
  const id = await enqueue();
  const { stopAssistantJob } = await import("../src/modules/ai/agent/run.js");
  const user = (await pool.query("SELECT * FROM users WHERE id = $1", [userId]))
    .rows[0];
  const logger = {
    error: () => {},
  } as unknown as import("fastify").FastifyBaseLogger;
  assert.equal(await stopAssistantJob(id, user, logger), true);
  const job = (
    await pool.query("SELECT state, result FROM ai_jobs WHERE id = $1", [id])
  ).rows[0];
  assert.equal(job.state, "done");
  assert.equal(job.result.assistant_run.outcome, "discarded");
  assert.equal(await claimAssistantJob("runner-a"), null);
});
