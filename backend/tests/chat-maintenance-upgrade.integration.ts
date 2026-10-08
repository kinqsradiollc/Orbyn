import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const directory = new URL("../migrations/", import.meta.url);
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { drainMemoryQueue } = await import("../src/worker/memory.js");
after(() => pool.end());
test("258 upgrade preserves legacy authority and old-writer progress through actual migration locking", async () => {
  assert.equal(
    (await pool.query("SELECT to_regclass('migrations') AS value")).rows[0]
      .value,
    null,
  );
  await transaction(async (db) => {
    await db.query(
      "CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith(".sql") && n < "258_")
      .sort()) {
      await db.query(
        await readFile(new URL(name, directory), "utf8"),
      );
      await db.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    }
  });
  const owner = randomUUID(),
    chat = randomUUID(),
    oldJob = randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Upgrade fixture','unusable')",
    [owner, owner + "@fixture.invalid"],
  );
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Legacy chat','person','[]')",
    [chat, owner],
  );
  const legacy = (
    await pool.query(
      "INSERT INTO memory_queue(chat_id,user_id,turns) VALUES($1,$2,'[]') RETURNING id",
      [chat, owner],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,state) VALUES($1,$2,'queued')",
    [oldJob, owner],
  );
  const worker = await pool.connect();
  let update: Promise<unknown> | undefined;
  try {
    await worker.query("BEGIN");
    await worker.query("SET LOCAL deadlock_timeout='10s'");
    await worker.query(
      "UPDATE ai_chats SET title='Old writer holds chat' WHERE id=$1",
      [chat],
    );
    const upgrading = migrate();
    let held = false;
    for (let n = 0; n < 200; n++) {
      held = Boolean(
        (
          await pool.query(
            "SELECT 1 FROM pg_locks WHERE relation='ai_jobs'::regclass AND mode='AccessExclusiveLock'",
          )
        ).rowCount,
      );
      if (held) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(held, "actual migrator requested its schema prelock");
    update = worker.query(
      "UPDATE ai_jobs SET heartbeat_at=clock_timestamp() WHERE id=$1",
      [oldJob],
    );
    await update;
    await worker.query("COMMIT");
    await upgrading;
  } finally {
    await worker.query("ROLLBACK").catch(() => {});
    worker.release();
  }
  await migrate();
  assert.equal(
    (
      await pool.query(
        "SELECT maintenance_job_id FROM memory_queue WHERE id=$1",
        [legacy],
      )
    ).rows[0].maintenance_job_id,
    null,
  );
  assert.equal(
    (await pool.query("SELECT runtime_lane FROM ai_jobs WHERE id=$1", [oldJob]))
      .rows[0].runtime_lane,
    "interactive",
  );
  await pool.query(
    "INSERT INTO user_ai_provider_choice(user_id,primary_provider,fallback_to_default) VALUES($1,'chatgpt',false)",
    [owner],
  );
  const fresh = (
    await pool.query(
      "INSERT INTO memory_queue(chat_id,user_id,turns) VALUES($1,$2,'[]') RETURNING maintenance_job_id",
      [chat, owner],
    )
  ).rows[0].maintenance_job_id;
  const job = (
    await pool.query(
      "SELECT runtime_lane,provider_choice_snapshot,managed_provider_snapshot FROM ai_jobs WHERE id=$1",
      [fresh],
    )
  ).rows[0];
  assert.equal(job.runtime_lane, "background");
  assert.equal(job.provider_choice_snapshot.primary, "chatgpt");
  assert.ok(job.managed_provider_snapshot);
  let calls = 0;
  await drainMemoryQueue({
    ai: {} as any,
    completeTurn: async () => {
      calls++;
      return '{"topics":[]}';
    },
  });
  assert.equal(
    calls,
    0,
    "neither legacy queue nor ChatGPT-only legacy-style insert can use injected managed AI",
  );
  await pool.query("DELETE FROM users WHERE id=$1", [owner]);
});
