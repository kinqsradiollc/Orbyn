import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "./setup.js";

const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
before(() => migrate());
after(() => pool.end());

test("reference indexing handles a bounded line with many unmatched code delimiters", async () => {
  const text = Array.from(
    { length: 130 },
    (_, index) => "`".repeat(index + 1) + " [Open] ",
  ).join("");
  assert.ok(text.length <= 10000);
  await transaction(async (db) => {
    // A query budget catches the former repeated substring scan without
    // making assertions about exact wall-clock timing on a busy CI runner.
    await db.query("SET LOCAL statement_timeout = '5s'");
    const masked = await db.query<{ text: string }>(
      "SELECT doc_reference_mask($1) AS text",
      [text],
    );
    assert.equal(masked.rows[0].text, text);
    const indexed = await db.query<{ count: string }>(
      "SELECT count(*) FROM doc_reference_targets($1::jsonb)",
      [
        JSON.stringify([
          {
            type: "paragraph",
            id: "definition",
            text: "[Open]: orbyn://doc/11111111-1111-4111-8111-111111111111",
          },
          { type: "paragraph", id: "usage", text },
        ]),
      ],
    );
    assert.equal(Number(indexed.rows[0].count), 130);
  });
});

test("a page without reference definitions has no reference index entries", async () => {
  const blocks = Array.from({ length: 100 }, (_, index) => ({
    type: "paragraph",
    id: `block-${index}`,
    text: "x".repeat(10000),
  }));
  await transaction(async (db) => {
    await db.query("SET LOCAL statement_timeout = '5s'");
    const result = await db.query(
      "SELECT * FROM doc_reference_targets($1::jsonb)",
      [JSON.stringify(blocks)],
    );
    assert.equal(result.rowCount, 0);
  });
});
