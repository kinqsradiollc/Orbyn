import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
before(() => migrate());
after(() => pool.end());
test("Teams lifecycle migration disables legacy DM authority without inventing an authenticated conversation timestamp", async () => {
  const db = await pool.connect();
  const schema = `teams_lifecycle_${randomUUID().replaceAll("-", "")}`;
  try {
    await db.query("BEGIN");
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema},public`);
    await db.query(
      `CREATE TABLE agent_channel_teams_installations(id uuid PRIMARY KEY,bot_app_id uuid,tenant_id uuid,dm_enabled boolean,conversation_encrypted text,version int,updated_at timestamptz)`,
    );
    const legacy = randomUUID(),
      unlinked = randomUUID(),
      bot = randomUUID(),
      tenant = randomUUID();
    await db.query(
      "INSERT INTO agent_channel_teams_installations VALUES($1,$3,$4,true,'encrypted-reference',4,now()),($2,$3,$4,false,NULL,2,now())",
      [legacy, unlinked, bot, tenant],
    );
    await db.query(
      readFileSync(
        new URL(
          "../migrations/250_teams_personal_conversation_lifecycle.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const rows = (
      await db.query(
        "SELECT * FROM agent_channel_teams_installations ORDER BY id",
      )
    ).rows;
    assert.equal(rows.find((row) => row.id === legacy).dm_enabled, false);
    assert.equal(rows.find((row) => row.id === legacy).version, 5);
    assert.equal(
      rows.find((row) => row.id === legacy).conversation_bound_at,
      null,
    );
    assert.equal(rows.find((row) => row.id === unlinked).version, 2);
    await db.query("SAVEPOINT invalid_proof");
    await assert.rejects(
      db.query(
        "UPDATE agent_channel_teams_installations SET conversation_route_hash=$1 WHERE id=$2",
        ["x".repeat(64), legacy],
      ),
      (e: any) => e.code === "23514",
    );
    await db.query("ROLLBACK TO SAVEPOINT invalid_proof");
    await db.query(
      "UPDATE agent_channel_teams_installations SET conversation_route_hash=$1,conversation_bound_at=now() WHERE id=$2",
      ["x".repeat(64), legacy],
    );
    await db.query("SAVEPOINT duplicate_route");
    await assert.rejects(
      db.query(
        "UPDATE agent_channel_teams_installations SET conversation_encrypted='other',conversation_route_hash=$1,conversation_bound_at=now() WHERE id=$2",
        ["x".repeat(64), unlinked],
      ),
      (e: any) => e.code === "23505",
    );
    await db.query("ROLLBACK TO SAVEPOINT duplicate_route");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
