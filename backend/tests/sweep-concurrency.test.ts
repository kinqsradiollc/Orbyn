import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { runSweep, SWEEP_RULES } = await import("../src/lib/sweep.js");
before(async () => {
  await migrate();
});
after(async () => {
  await pool.end();
});

test("the actual sweeper survives tuple replacement and rechecks retention eligibility using composite keys", async () => {
  const table = `sweep_race_${randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `CREATE TABLE ${table}(tenant integer NOT NULL,id integer NOT NULL,eligible boolean NOT NULL,version integer NOT NULL,PRIMARY KEY(tenant,id))`,
  );
  const rule = {
    key: table,
    label: "Concurrency fixture",
    detail: "Disposable fixture only",
    table,
    where: "eligible",
    days: 0,
    configurable: false,
  };
  SWEEP_RULES.push(rule);
  try {
    for (const remainsEligible of [true, false]) {
      await pool.query(`TRUNCATE ${table}`);
      await pool.query(
        `INSERT INTO ${table} VALUES(1,1,true,0),(2,1,false,0),(1,2,false,0)`,
      );
      const holder = await pool.connect();
      await holder.query("BEGIN");
      await holder.query(
        `UPDATE ${table} SET version=1,eligible=$1 WHERE tenant=1 AND id=1`,
        [remainsEligible],
      );
      const sweep = runSweep();
      let observed = false;
      try {
        for (let i = 0; i < 300; i++) {
          await holder.query("SELECT pg_stat_clear_snapshot()");
          const wait = await holder.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1",
            [`DELETE FROM ${table}%`],
          );
          if (wait.rowCount) {
            observed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        await holder.query("COMMIT");
        holder.release();
      }
      const result = await sweep;
      assert.ok(
        observed,
        "the production deletion must actually wait for the concurrent update",
      );
      assert.ok(result, "the sweep must acquire its advisory lease");
      assert.equal(result.errors[table], undefined);
      assert.equal(result.removed[table], remainsEligible ? 1 : 0);
      const rows = (
        await pool.query(`SELECT tenant,id FROM ${table} ORDER BY tenant,id`)
      ).rows;
      assert.deepEqual(
        rows,
        remainsEligible
          ? [
              { tenant: 1, id: 2 },
              { tenant: 2, id: 1 },
            ]
          : [
              { tenant: 1, id: 1 },
              { tenant: 1, id: 2 },
              { tenant: 2, id: 1 },
            ],
      );
    }
  } finally {
    SWEEP_RULES.splice(SWEEP_RULES.indexOf(rule), 1);
    await pool.query(`DROP TABLE ${table}`);
  }
});

test("retention reports a table without a primary key and preserves its data", async () => {
  const table = `sweep_no_key_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE TABLE ${table}(eligible boolean NOT NULL)`);
  await pool.query(`INSERT INTO ${table} VALUES(true)`);
  const rule = {
    key: table,
    label: "Missing key fixture",
    detail: "Disposable fixture only",
    table,
    where: "eligible",
    days: 0,
    configurable: false,
  };
  SWEEP_RULES.push(rule);
  try {
    const result = await runSweep();
    assert.ok(result);
    assert.match(result.errors[table], /stable primary key/);
    assert.equal(result.removed[table], undefined);
    assert.equal((await pool.query(`SELECT 1 FROM ${table}`)).rowCount, 1);
  } finally {
    SWEEP_RULES.splice(SWEEP_RULES.indexOf(rule), 1);
    await pool.query(`DROP TABLE ${table}`);
  }
});

test("fixed retention uses its declared duration and preserves recent records", async () => {
  const table = `sweep_fixed_${randomUUID().replaceAll("-", "")}`;
  await pool.query(
    `CREATE TABLE ${table}(id integer PRIMARY KEY,at timestamptz NOT NULL)`,
  );
  await pool.query(
    `INSERT INTO ${table} VALUES(1,now()-interval '1 day'),(2,now()-interval '15 days')`,
  );
  const rule = {
    key: table,
    label: "Fixed retention fixture",
    detail: "Disposable fixture only",
    table,
    where: "at < now() - make_interval(days => $1::int)",
    days: 14,
    configurable: false,
  };
  SWEEP_RULES.push(rule);
  try {
    const result = await runSweep();
    assert.ok(result);
    assert.equal(result.errors[table], undefined);
    assert.equal(result.removed[table], 1);
    assert.deepEqual(
      (await pool.query(`SELECT id FROM ${table} ORDER BY id`)).rows,
      [{ id: 1 }],
    );
  } finally {
    SWEEP_RULES.splice(SWEEP_RULES.indexOf(rule), 1);
    await pool.query(`DROP TABLE ${table}`);
  }
});
