import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { retryMigrationTransaction } from "../src/db/migration-retry.js";
import {
  lockMigrationJobTable,
  lockMigrationDocumentTables,
} from "../src/db/migration-locks.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const schema = `migration_retry_${randomUUID().replaceAll("-", "_")}`;
before(() => migrate());
after(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

test("schema prelock lets an existing worker finish its claim before migration obtains the table", async () => {
  const worker = await pool.connect(),
    migration = await pool.connect();
  let pending: Promise<void> | undefined;
  try {
    await worker.query("BEGIN");
    await migration.query("BEGIN");
    await worker.query("SELECT id FROM ai_jobs WHERE false FOR UPDATE");
    const workerPid = (await worker.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const migrationPid = (
      await migration.query("SELECT pg_backend_pid() AS pid")
    ).rows[0].pid;
    pending = lockMigrationJobTable(migration, [
      "ALTER TABLE ai_jobs ADD COLUMN fixture int",
    ]);
    void pending.catch(() => undefined);
    const deadline = Date.now() + 2000;
    let blocked = false;
    do {
      const row = (
        await pool.query(
          "SELECT $2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1",
          [migrationPid, workerPid],
        )
      ).rows[0];
      if (row?.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    assert.equal(blocked, true);
    await worker.query("UPDATE ai_jobs SET heartbeat_at=now() WHERE false");
    await worker.query("COMMIT");
    await pending;
    const modes = (
      await migration.query(
        "SELECT mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation='ai_jobs'::regclass AND granted",
      )
    ).rows.map((row) => row.mode);
    assert.ok(modes.includes("AccessExclusiveLock"));
  } finally {
    await worker.query("ROLLBACK").catch(() => undefined);
    await pending?.catch(() => undefined);
    await migration.query("ROLLBACK").catch(() => undefined);
    worker.release();
    migration.release();
  }
});

test("real PostgreSQL deadlock rolls back DDL and reruns the whole bounded transaction", async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(
    `CREATE TABLE ${schema}.rows(id int PRIMARY KEY, value int NOT NULL)`,
  );
  await pool.query(`INSERT INTO ${schema}.rows VALUES(1,0),(2,0)`);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let locked = 0;
  const attempts = [0, 0],
    retries: string[] = [];
  const operation = (index: number, first: number, second: number) =>
    retryMigrationTransaction(
      async () => {
        attempts[index]++;
        await transaction(async (db) => {
          // Recreating the same marker on retry proves the aborted DDL rolled back.
          await db.query(`CREATE TABLE ${schema}.marker_${index}(id int)`);
          await db.query(
            `UPDATE ${schema}.rows SET value=value+1 WHERE id=$1`,
            [first],
          );
          if (attempts[index] === 1) {
            if (++locked === 2) release();
            await ready;
          }
          await db.query(
            `UPDATE ${schema}.rows SET value=value+1 WHERE id=$1`,
            [second],
          );
        });
      },
      {
        report: (_attempt, error) => {
          retries.push((error as { code: string }).code);
        },
      },
    );
  await Promise.all([operation(0, 1, 2), operation(1, 2, 1)]);
  assert.deepEqual(retries, ["40P01"]);
  assert.equal(attempts[0] + attempts[1], 3);
  assert.deepEqual(
    (await pool.query(`SELECT value FROM ${schema}.rows ORDER BY id`)).rows.map(
      (row) => row.value,
    ),
    [2, 2],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1 AND table_name LIKE 'marker_%'",
        [schema],
      )
    ).rows[0].n,
    2,
  );
});

test("document prelock lets an existing save finish before locking docs and history", async () => {
  const worker = await pool.connect(),
    migration = await pool.connect();
  let pending: Promise<void> | undefined;
  try {
    await worker.query("BEGIN");
    await migration.query("BEGIN");
    await worker.query("SELECT id FROM docs WHERE false FOR UPDATE");
    const workerPid = (await worker.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const migrationPid = (
      await migration.query("SELECT pg_backend_pid() AS pid")
    ).rows[0].pid;
    pending = lockMigrationDocumentTables(migration, [
      "ALTER TABLE docs ADD COLUMN fixture int",
    ]);
    void pending.catch(() => undefined);
    let blocked = false;
    const deadline = Date.now() + 2000;
    do {
      const row = (
        await pool.query(
          "SELECT $2::int=ANY(pg_blocking_pids(pid)) AS blocked FROM pg_stat_activity WHERE pid=$1",
          [migrationPid, workerPid],
        )
      ).rows[0];
      if (row?.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    assert.equal(blocked, true);
    await worker.query(
      "INSERT INTO doc_versions(doc_id,version,title,content) SELECT id,version,title,content FROM docs WHERE false",
    );
    await worker.query("UPDATE docs SET updated_at=now() WHERE false");
    await worker.query("COMMIT");
    await pending;
    const locks = (
      await migration.query(
        "SELECT relation::regclass::text AS name,mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation IN ('docs'::regclass,'doc_versions'::regclass) AND granted",
      )
    ).rows;
    assert.ok(
      locks.some(
        (row) => row.name === "docs" && row.mode === "AccessExclusiveLock",
      ),
    );
    assert.ok(
      locks.some(
        (row) =>
          row.name === "doc_versions" && row.mode === "AccessExclusiveLock",
      ),
    );
  } finally {
    await worker.query("ROLLBACK").catch(() => undefined);
    await pending?.catch(() => undefined);
    await migration.query("ROLLBACK").catch(() => undefined);
    worker.release();
    migration.release();
  }
});
