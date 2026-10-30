import "./setup.js";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUuidSql } from "../src/lib/canonical-uuid-sql.js";

const { pool } = await import("../src/db/pool.js");

after(() => pool.end());

test("indexed UUID lookups preserve canonical text equality without invalid casts", async () => {
  const id = "abcdef01-2345-6789-abcd-ef0123456789";
  const inputs = [
    id,
    null,
    "",
    "missing",
    id.toUpperCase(),
    ` ${id}`,
    `${id} `,
    `${id}\n`,
    `${id}\r\n`,
    `{${id}}`,
    id.replaceAll("-", ""),
    `${id}:extra`,
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ];
  const rows = (
    await pool.query<{
      value: string | null;
      old_match: boolean;
      indexed_match: boolean;
      parsed: string | null;
    }>(
      `SELECT value, coalesce($1::uuid::text=value,false) AS old_match,
        coalesce($1::uuid=${canonicalUuidSql("value")},false) AS indexed_match,
        ${canonicalUuidSql("value")}::text AS parsed
       FROM unnest($2::text[]) WITH ORDINALITY AS input(value,position)
       ORDER BY position`,
      [id, inputs],
    )
  ).rows;
  assert.equal(rows.length, inputs.length);
  for (const row of rows)
    assert.equal(row.indexed_match, row.old_match, JSON.stringify(row.value));
  assert.equal(rows[0].parsed, id);
  assert.equal(rows[4].parsed, null, "upper-case references stay unmatched");
  assert.equal(rows[12].parsed, inputs[12], "all canonical UUID values work");
  assert.equal(rows[13].parsed, inputs[13]);
});
