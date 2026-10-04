import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool, transaction } = await import("../src/db/pool.js");
after(() => pool.end());
test("a checked-out client disconnect rejects its transaction without an unhandled error or retry", async () => {
  const tag = `orbyn-disconnect-${randomUUID()}`;
  let enter!: () => void, resume!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const continueWork = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let pid = 0,
    attempts = 0;
  const work = transaction(async (db) => {
    attempts++;
    assert.ok(
      db.listenerCount("error") > 0,
      "checked-out clients have a transport-error observer",
    );
    await db.query("SELECT set_config('application_name',$1,true)", [tag]);
    pid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    enter();
    await continueWork;
    return db.query("SELECT 1");
  });
  // Register rejection handling before terminating the owned backend.
  const failed = assert.rejects(
    work,
    /terminating connection|connection error|terminated|not queryable/i,
  );
  await entered;
  try {
    const killed = await pool.query(
      "SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE pid=$1 AND datname=current_database() AND application_name=$2",
      [pid, tag],
    );
    assert.equal(killed.rows[0]?.killed, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    resume();
  }
  await failed;
  assert.equal(attempts, 1);
  assert.equal((await pool.query("SELECT 1 AS healthy")).rows[0].healthy, 1);
});
