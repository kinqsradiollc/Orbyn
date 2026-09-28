import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const users: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [users]);
  await app.close();
  await pool.end();
});

async function register() {
  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `durable-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Run tester",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const { user, token } = response.json();
  users.push(user.id);
  return {
    id: user.id as string,
    headers: { authorization: `Bearer ${token}` },
  };
}

test("saved chats expose live jobs and ownership across all active states", async () => {
  const owner = await register();
  const other = await register();
  const { beginChatTurn } = await import("../src/modules/ai/chats.js");
  const user = (
    await pool.query("SELECT * FROM users WHERE id = $1", [owner.id])
  ).rows[0];
  const chatId = randomUUID();
  const turnId = randomUUID();
  await beginChatTurn(user, {
    chatId,
    turnId,
    message: "Plan tomorrow",
    scope: null,
    legacyHistory: [],
  });
  const job = (
    await pool.query(
      `INSERT INTO ai_jobs(user_id, chat_id, turn_id, state, progress, run_state)
     VALUES($1, $2, $3, 'queued', '{"label":"Queued"}', '{"state":{"waiting":{"kind":"person","question":"When?"}}}') RETURNING id`,
      [owner.id, chatId, turnId],
    )
  ).rows[0];
  for (const state of ["queued", "running", "waiting"]) {
    await pool.query("UPDATE ai_jobs SET state = $2 WHERE id = $1", [
      job.id,
      state,
    ]);
    const chat = await app.inject({
      url: `/ai/chats/${chatId}`,
      headers: owner.headers,
    });
    assert.equal(chat.statusCode, 200, chat.body);
    assert.equal(chat.json().active_job.id, job.id);
    assert.equal(chat.json().active_job.state, state);
    const history = await app.inject({
      url: "/ai/chats",
      headers: owner.headers,
    });
    assert.equal(
      history.json().find((row: { id: string }) => row.id === chatId).active,
      state === "waiting" ? "needs_you" : "working",
    );
    const active = await app.inject({
      url: "/ai/jobs/active",
      headers: owner.headers,
    });
    assert.equal(active.statusCode, 200, active.body);
    assert.equal(
      active.json().find((row: { id: string }) => row.id === job.id).chat_id,
      chatId,
    );
  }
  const hidden = await app.inject({
    url: `/ai/chats/${chatId}`,
    headers: other.headers,
  });
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(
    (
      await app.inject({ url: "/ai/jobs/active", headers: other.headers })
    ).json(),
    [],
  );
  assert.equal((await app.inject({ url: "/ai/jobs/active" })).statusCode, 401);
  await pool.query("UPDATE ai_jobs SET state = 'done' WHERE id = $1", [job.id]);
  assert.equal(
    (
      await app.inject({ url: `/ai/chats/${chatId}`, headers: owner.headers })
    ).json().active_job,
    null,
  );
  await pool.query("DELETE FROM ai_chats WHERE id = $1", [chatId]);
  assert.equal(
    (await pool.query("SELECT id FROM ai_jobs WHERE id = $1", [job.id]))
      .rowCount,
    0,
  );
});
