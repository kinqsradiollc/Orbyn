import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantSourceGraphSql } =
  await import("../src/lib/assistant-source-visibility.js");

before(() => migrate());
after(() => pool.end());

async function fixture(
  work: (db: PoolClient, owner: string, other: string) => Promise<void>,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const owner = randomUUID(),
      other = randomUUID();
    for (const id of [owner, other])
      await db.query(
        "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Graph QA')",
        [id, `${id}@example.test`],
      );
    await work(db, owner, other);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}

async function doc(db: PoolClient, owner: string) {
  return (
    await db.query(
      "INSERT INTO docs(user_id,title) VALUES($1,'Graph source') RETURNING id",
      [owner],
    )
  ).rows[0].id as string;
}

// Compare the installed shortcut with the unchanged general graph in every
// authority state, including transitions after the function has been called.
async function visible(
  db: PoolClient,
  owner: string | null,
  id: string | null,
  expected: boolean,
  personal: boolean | null = true,
  teams: string[] | null = [],
  kind: string | null = "doc",
) {
  const general = assistantSourceGraphSql(
    "SELECT $2::text AS kind,$3::uuid AS id",
    "$1",
    { user: "$1", personal: "$4", teams: "$5" },
  );
  const row = (
    await db.query(
      `SELECT assistant_source_graph_visible($2,$3,$1,$4,$5) AS installed, ${general} AS general`,
      [owner, kind, id, personal, teams],
    )
  ).rows[0];
  assert.equal(row.installed, expected);
  assert.equal(row.installed, row.general);
}

test("leaf documents retain current owner, personal, deletion and project authority", async () =>
  fixture(async (db, owner, other) => {
    const id = await doc(db, owner);
    await visible(db, owner, id, true);
    await visible(db, owner, id, false, null, null);
    await visible(db, owner, id, true, true, null);
    await visible(db, owner, null, false);
    await visible(db, null, id, false);
    await visible(db, owner, id, false, true, [], null);
    await visible(db, owner, id, false, false);
    await visible(db, other, id, false);
    await visible(db, owner, randomUUID(), false);
    await db.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [id]);
    await visible(db, owner, id, false);
    const project = (
      await db.query(
        "INSERT INTO projects(user_id,name,assistant_off) VALUES($1,'Private project',true) RETURNING id",
        [owner],
      )
    ).rows[0].id;
    await db.query(
      "UPDATE docs SET deleted_at=NULL,project_id=$2 WHERE id=$1",
      [id, project],
    );
    await visible(db, owner, id, false);
    await db.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
      project,
    ]);
    await visible(db, owner, id, true);
    await db.query("UPDATE docs SET user_id=$2 WHERE id=$1", [id, other]);
    await visible(db, owner, id, false);
  }));

test("leaf team scope cannot outlive membership or borrow another team", async () =>
  fixture(async (db, owner, other) => {
    const team = (
      await db.query(
        "INSERT INTO teams(name,created_by) VALUES('Graph team',$1) RETURNING id",
        [other],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'member')",
      [team, owner],
    );
    const id = await doc(db, other);
    await db.query("UPDATE docs SET team_id=$2 WHERE id=$1", [id, team]);
    await visible(db, owner, id, true, false, [team]);
    await visible(db, owner, id, true, null, [team]);
    await visible(db, owner, id, false, null, null);
    await visible(db, owner, id, false, false, []);
    await db.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
      team,
      owner,
    ]);
    await visible(db, owner, id, false, false, [team]);
  }));

test("adding, revoking and removing a qualifying document edge switches authority immediately", async () =>
  fixture(async (db, owner, other) => {
    const root = await doc(db, owner),
      child = await doc(db, owner);
    await visible(db, owner, root, true);
    await db.query(
      "INSERT INTO memory_sources(doc_id,source_type,source_id,label) VALUES($1,'doc',$2,'Source')",
      [root, child],
    );
    await visible(db, owner, root, true);
    await db.query("UPDATE docs SET user_id=$2 WHERE id=$1", [child, other]);
    await visible(db, owner, root, false);
    await db.query("DELETE FROM memory_sources WHERE doc_id=$1", [root]);
    await visible(db, owner, root, true);
    await db.query(
      "INSERT INTO memory_sources(doc_id,source_type,source_id,label) VALUES($1,'task',$2,'Missing')",
      [root, randomUUID()],
    );
    await visible(db, owner, root, false);
  }));

test("only exact graph edges disable the shortcut, including dangling retained entries", async () =>
  fixture(async (db, owner) => {
    const root = await doc(db, owner);
    await db.query(
      "INSERT INTO memory_sources(doc_id,source_type,source_id,label,retained_entries) VALUES($1,'chat',$2,'Retained',true),($1,'doc',NULL,'No ID',false),($1,'person',$3,'Person',false)",
      [root, randomUUID(), randomUUID()],
    );
    await visible(db, owner, root, true);
    await db.query(
      "INSERT INTO memory_entry_sources(doc_id,source_entry_id) VALUES($1,$2)",
      [root, randomUUID()],
    );
    await visible(db, owner, root, false);
    await db.query("DELETE FROM memory_entry_sources WHERE doc_id=$1", [root]);
    await visible(db, owner, root, true);
    await db.query(
      "UPDATE memory_sources SET retained_entries=false WHERE doc_id=$1 AND source_type='chat'",
      [root],
    );
    await visible(db, owner, root, false);
  }));

test("cycles and non-document roots still use the general transitive guard", async () =>
  fixture(async (db, owner, other) => {
    const root = await doc(db, owner),
      child = await doc(db, owner);
    await db.query(
      "INSERT INTO memory_sources(doc_id,source_type,source_id,label) VALUES($1,'doc',$2,'Cycle'),($2,'doc',$1,'Cycle')",
      [root, child],
    );
    await visible(db, owner, root, true);
    await db.query("UPDATE docs SET user_id=$2 WHERE id=$1", [child, other]);
    await visible(db, owner, root, false);
    const task = (
      await db.query(
        "INSERT INTO items(user_id,title,kind) VALUES($1,'Task','task') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    await visible(db, owner, task, true, true, [], "task");
    await visible(db, other, task, false, true, [], "task");
    await visible(db, owner, root, false, true, [], "unknown");
  }));
