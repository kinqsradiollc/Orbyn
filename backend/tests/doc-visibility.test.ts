import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * Task context, the assistant and project search share one page-visibility
 * rule. When pages can be trashed (docs.deleted_at), that rule must leave
 * trashed pages out: this fails until DOCS_HAVE_TRASH is switched on.
 */
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { DOCS_HAVE_TRASH, docVisibleTo, docReadableBy } =
  await import("../src/lib/doc-visibility.js");

before(async () => {
  await migrate();
});
after(async () => {
  await pool.end();
});

test("the shared page rule leaves out trashed pages whenever pages can be trashed", async () => {
  const trash = (
    await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'docs' AND column_name = 'deleted_at'`,
    )
  ).rowCount;
  assert.equal(DOCS_HAVE_TRASH, trash === 1);
  assert.equal(docVisibleTo("$1").includes("deleted_at IS NULL"), trash === 1);
  // History keeps a trashed page's entries; it only checks who may read it.
  assert.ok(!docReadableBy("$1").includes("deleted_at"));
  // The rule is valid SQL against the real table.
  await pool.query(`SELECT count(*) FROM docs d WHERE ${docVisibleTo("$1")}`, [
    "00000000-0000-0000-0000-000000000000",
  ]);
});
