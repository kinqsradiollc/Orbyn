import { test } from "node:test";
import assert from "node:assert/strict";
import { lockMigrationDocumentTables } from "../src/db/migration-locks.js";
import type { Queryable } from "../src/db/pool.js";

async function capture(pending: string[], docs: boolean, versions: boolean) {
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [{ docs, versions }] };
    },
  } as unknown as Queryable;
  await lockMigrationDocumentTables(db, pending);
  return calls;
}

test("document prelock does nothing for unrelated batches", async () => {
  assert.deepEqual(
    await capture(["ALTER TABLE items ADD COLUMN x text"], true, true),
    [],
  );
});
test("fresh databases do not lock tables that the batch will create", async () => {
  const calls = await capture(["CREATE TABLE docs (id uuid)"], false, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /to_regclass/);
});
test("existing document/history relations take the strongest lock before batch SQL", async () => {
  const calls = await capture(
    ["SELECT * FROM docs", "ALTER TABLE doc_versions ADD COLUMN x text"],
    true,
    true,
  );
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1],
    "LOCK TABLE docs, doc_versions IN ACCESS EXCLUSIVE MODE",
  );
});
test("partial historic schemas lock only existing relations in a fixed order", async () => {
  assert.equal(
    (await capture(["ALTER TABLE docs ADD COLUMN x text"], true, false))[1],
    "LOCK TABLE docs IN ACCESS EXCLUSIVE MODE",
  );
  assert.equal(
    (
      await capture(["ALTER TABLE doc_versions ADD COLUMN x text"], false, true)
    )[1],
    "LOCK TABLE doc_versions IN ACCESS EXCLUSIVE MODE",
  );
});
