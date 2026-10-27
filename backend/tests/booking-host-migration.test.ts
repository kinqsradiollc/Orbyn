import "./setup.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { pool } = await import("../src/db/pool.js");
after(() => pool.end());

test("booking host upgrade removes only stale team assignments and remains safe to repeat", async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(`
      CREATE TEMP TABLE booking_pages(id int PRIMARY KEY, team_id int) ON COMMIT DROP;
      CREATE TEMP TABLE team_members(team_id int, user_id int) ON COMMIT DROP;
      CREATE TEMP TABLE booking_hosts(page_id int, user_id int) ON COMMIT DROP;
      INSERT INTO booking_pages VALUES (1,NULL),(2,10),(3,20);
      INSERT INTO team_members VALUES (10,100),(20,200);
      INSERT INTO booking_hosts VALUES (1,100),(1,300),(2,100),(2,200),(2,300),(3,200);
    `);
    const sql = await readFile(
      new URL(
        "../migrations/296_booking_prune_removed_hosts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(sql);
    const surviving = () =>
      db.query(
        "SELECT page_id,user_id FROM booking_hosts ORDER BY page_id,user_id",
      );
    const expected = [
      { page_id: 1, user_id: 100 },
      { page_id: 1, user_id: 300 },
      { page_id: 2, user_id: 100 },
      { page_id: 3, user_id: 200 },
    ];
    assert.deepEqual((await surviving()).rows, expected);
    await db.query(sql);
    assert.deepEqual((await surviving()).rows, expected);
    await db.query("INSERT INTO team_members VALUES(10,300)");
    assert.deepEqual(
      (await surviving()).rows,
      expected,
      "rejoining cannot resurrect the deleted assignment",
    );
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
