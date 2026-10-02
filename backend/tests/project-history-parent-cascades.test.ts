import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
import type { Queryable } from "../src/db/pool.js";
before(() => migrate());
after(() => pool.end());

async function fixture(db: Queryable, shared = false) {
  const owner = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','History cascade')",
    [owner, `history-cascade-${owner}@example.test`],
  );
  const team = shared
    ? (
        await db.query(
          "INSERT INTO teams(name,created_by) VALUES('History scope',$1) RETURNING id",
          [owner],
        )
      ).rows[0].id
    : null;
  const project = (
    await db.query(
      "INSERT INTO projects(user_id,team_id,name) VALUES($1,$2,'History parent') RETURNING id",
      [owner, team],
    )
  ).rows[0].id;
  const task = (
    await db.query(
      "INSERT INTO items(user_id,team_id,project_id,title) VALUES($1,$2,$3,'History task') RETURNING id",
      [owner, team, project],
    )
  ).rows[0].id;
  const doc = (
    await db.query(
      "INSERT INTO docs(user_id,team_id,project_id,title) VALUES($1,$2,$3,'History page') RETURNING id",
      [owner, team, project],
    )
  ).rows[0].id;
  const record = (
    await db.query(
      "INSERT INTO work_records(created_by,team_id,project_id,kind,title) VALUES($1,$2,$3,'promise','History promise') RETURNING id",
      [owner, team, project],
    )
  ).rows[0].id;
  return { owner, team, project, task, doc, record };
}
async function inRollback(fn: (db: Queryable) => Promise<void>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await fn(db);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}

test("the previous history trigger reproduces the account cascade foreign-key failure", async () => {
  await inRollback(async (db) => {
    const sql = await readFile(
      new URL(
        "../migrations/084_project_history_access_index.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(
      sql.slice(
        sql.indexOf("CREATE OR REPLACE FUNCTION"),
        sql.indexOf("\nDROP TRIGGER"),
      ),
    );
    const f = await fixture(db);
    // Access metadata can already have been swept. Force the old trigger's
    // INSERT path independently of PostgreSQL's foreign-key cascade ordering.
    await db.query("DELETE FROM project_history_access WHERE user_id=$1", [
      f.owner,
    ]);
    await db.query("SAVEPOINT old_delete");
    await assert.rejects(
      db.query("DELETE FROM users WHERE id=$1", [f.owner]),
      (e: unknown) =>
        (e as { code?: string; constraint?: string }).code === "23503" &&
        (e as { constraint?: string }).constraint ===
          "project_history_access_user_id_fkey",
    );
    await db.query("ROLLBACK TO SAVEPOINT old_delete");
    assert.equal(
      (await db.query("SELECT 1 FROM users WHERE id=$1", [f.owner])).rowCount,
      1,
    );
  });
});
for (const shared of [false, true]) {
  test(`account deletion cascades ${shared ? "team" : "personal"} project children without recreating history access`, async () => {
    await inRollback(async (db) => {
      const f = await fixture(db, shared);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM project_history_access WHERE user_id=$1",
            [f.owner],
          )
        ).rows[0].n,
        3,
      );
      await db.query("DELETE FROM users WHERE id=$1", [f.owner]);
      assert.equal(
        (await db.query("SELECT 1 FROM users WHERE id=$1", [f.owner])).rowCount,
        0,
      );
      assert.equal(
        (
          await db.query(
            "SELECT 1 FROM project_history_access WHERE user_id=$1",
            [f.owner],
          )
        ).rowCount,
        0,
      );
      for (const [table, id] of [
        ["items", f.task],
        ["docs", f.doc],
        ["work_records", f.record],
      ] as const)
        assert.equal(
          (await db.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id])).rowCount,
          0,
        );
    });
  });
}
test("team deletion does not convert removed team history into personal access", async () => {
  await inRollback(async (db) => {
    const f = await fixture(db, true);
    await db.query("DELETE FROM teams WHERE id=$1", [f.team]);
    assert.equal(
      (await db.query("SELECT 1 FROM users WHERE id=$1", [f.owner])).rowCount,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM project_history_access WHERE user_id=$1",
          [f.owner],
        )
      ).rowCount,
      0,
    );
  });
});
test("ordinary task, page and record deletion retains the original access metadata", async () => {
  await inRollback(async (db) => {
    const f = await fixture(db, true);
    for (const [table, id] of [
      ["items", f.task],
      ["docs", f.doc],
      ["work_records", f.record],
    ] as const)
      await db.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    const metadata = (
      await db.query(
        "SELECT entity_type,team_id,user_id FROM project_history_access WHERE entity_id=ANY($1::uuid[]) ORDER BY entity_type",
        [[f.task, f.doc, f.record]],
      )
    ).rows;
    assert.deepEqual(
      metadata.map((r) => r.entity_type),
      ["note", "record", "task"],
    );
    assert.ok(
      metadata.every((r) => r.user_id === f.owner && r.team_id === f.team),
    );
  });
});
