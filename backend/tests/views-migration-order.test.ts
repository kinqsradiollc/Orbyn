import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * The views track (D4a, track/pages) owns saved_views and object_links: its
 * migrations 111_object_links and 112_saved_views_fields sort before this
 * track's 153_links_and_views. On a database where they ran first, 153 must
 * leave their tables as they are (and add only the 'related' link kind),
 * and the agents' saved views must write the rows the app reads.
 *
 * Everything here runs in one transaction that is rolled back, so the test
 * database keeps its own tables. The two migrations are copies of the views
 * track's files (tests/fixtures/pages-track).
 */

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { createView, findView, updateView, deleteView, everySpace } =
  await import("../src/capabilities/view-store.js");
const { viewDefinition } = await import("@orbyn/core");

const sql = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

before(async () => {
  await migrate();
});

after(async () => {
  await pool.end();
});

class Rollback extends Error {}

test("153 after the views track's 111 and 112: their tables kept, agents' views work", async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const u = (
      await db.query(
        `INSERT INTO users (email, name, password_hash)
         VALUES ('views-order@example.test', 'Order', 'x') RETURNING *`,
      )
    ).rows[0];
    // The views track's migrations run first, on a database without them.
    await db.query(
      "DROP TABLE IF EXISTS saved_view_pins, saved_views, object_links CASCADE",
    );
    await db.query(await sql("./fixtures/pages-track/111_object_links.sql"));
    await db.query(
      await sql("./fixtures/pages-track/112_saved_views_fields.sql"),
    );
    // Then this track's.
    await db.query(await sql("../migrations/153_links_and_views.sql"));

    const columns = (
      await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'saved_views' ORDER BY ordinal_position`,
      )
    ).rows.map((r) => r.column_name);
    assert.deepEqual(columns, [
      "id",
      "user_id",
      "team_id",
      "name",
      "source",
      "definition",
      "created_at",
      "updated_at",
    ]);
    const kinds = (
      await db.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'object_links_link_kind_check'`,
      )
    ).rows[0].def;
    assert.match(kinds, /'related'/);
    assert.match(kinds, /'meeting'/);

    // The agents' saved views on the views track's table.
    const made = await createView(db, u, {
      name: "Due this week",
      team_id: null,
      definition: viewDefinition.parse({
        source: "tasks",
        filters: { due_within_days: 7 },
        group_by: "priority",
      }),
    });
    const row = (
      await db.query(
        "SELECT source, definition FROM saved_views WHERE id = $1",
        [made.id],
      )
    ).rows[0];
    assert.equal(row.source, "tasks");
    assert.equal(viewDefinition.parse(row.definition).group_by, "priority");
    const changed = await updateView(db, u, made.id, {
      version: made.version,
      name: "Due soon",
    });
    assert.ok(changed.version > made.version);
    await assert.rejects(
      updateView(db, u, made.id, { version: made.version, name: "Stale" }),
      /changed since/,
    );
    // A pin the app made goes with the view.
    await db.query(
      "INSERT INTO saved_view_pins (user_id, view_id) VALUES ($1, $2)",
      [u.id, made.id],
    );
    await deleteView(db, u, made.id);
    assert.equal(await findView(db, everySpace(u.id), made.id), null);
    assert.equal(
      (
        await db.query("SELECT 1 FROM saved_view_pins WHERE view_id = $1", [
          made.id,
        ])
      ).rowCount,
      0,
    );
    // And 153 runs again over it.
    await db.query(await sql("../migrations/153_links_and_views.sql"));
    throw new Rollback();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
