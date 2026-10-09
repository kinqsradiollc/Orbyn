import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { HttpError } from "@orbyn/core";

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { reserveAssistantWork } =
  await import("../src/modules/ai/agent/work-budget.js");
const { readAssistantBudget, replaceAssistantBudget } =
  await import("../src/modules/assistant-workspace/budgets.js");

const owners: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});

async function owner() {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Budget owner')",
    [id, `c3-budget-${id}@example.test`],
  );
  return id;
}

async function job(userId: string) {
  const chat = randomUUID();
  const id = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Budget work','task')",
    [chat, userId],
  );
  await pool.query(
    `INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin,run_state)
     VALUES($1,$2,$3,$4,'running','task','{"version":1}'::jsonb)`,
    [id, userId, chat, randomUUID()],
  );
  return id;
}

test("owner budget revisions reject stale editors", async () => {
  const userId = await owner();
  const first = await readAssistantBudget(pool, userId, "background");
  const change = {
    expected_revision: first.revision,
    daily_token_limit: 4000,
    hourly_start_limit: 2,
    per_run_token_limit: 2000,
  };
  const saved = await replaceAssistantBudget(userId, "background", change);
  assert.equal(saved.revision, first.revision + 1);
  assert.equal(saved.daily_token_limit, 4000);
  await assert.rejects(
    replaceAssistantBudget(userId, "background", change),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(
    (await readAssistantBudget(pool, userId, "overnight")).revision,
    1,
  );
});

test("reservations count active estimates, settle once, and stop at a lane limit", async () => {
  const userId = await owner();
  await replaceAssistantBudget(userId, "background", {
    expected_revision: 1,
    daily_token_limit: 1000,
    hourly_start_limit: 1,
    per_run_token_limit: 1000,
  });
  const firstJob = await job(userId);
  const secondJob = await job(userId);
  const reserve = (id: string) =>
    transaction((db) =>
      reserveAssistantWork(db, {
        kind: "job",
        id,
        userId,
        lane: "background",
        startingEstimate: 0,
        originalLimit: 1000,
        minimumReservation: 1000,
      }),
    );
  assert.equal(await reserve(firstJob), 1000);
  assert.equal(await reserve(secondJob), null);
  assert.equal(
    (await readAssistantBudget(pool, userId, "background"))
      .active_reserved_tokens,
    1000,
  );
  await pool.query(
    `UPDATE ai_jobs SET state='done',
      result='{"assistant_run":{"token_estimate":250}}'::jsonb WHERE id=$1`,
    [firstJob],
  );
  const settled = await readAssistantBudget(pool, userId, "background");
  assert.equal(settled.active_reserved_tokens, 0);
  assert.equal(settled.estimated_tokens, 250);
  assert.equal(await reserve(secondJob), null); // The hourly start cap remains.
  assert.equal(
    (await readAssistantBudget(pool, userId, "overnight")).starts_last_hour,
    0,
  );
});
