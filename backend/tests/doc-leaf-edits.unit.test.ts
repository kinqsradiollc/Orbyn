import { test } from "node:test";
import assert from "node:assert/strict";
import { docContainerBlocks, parseDocContainers, HttpError } from "@orbyn/core";
import { writeDocLeafEdits } from "../src/modules/docs/leaf-edits.js";
import type { Db } from "../src/db/pool.js";

function fixture(row: unknown) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return {
        rows: sql.startsWith("SELECT content_format") ? (row ? [row] : []) : [],
      };
    },
  } as unknown as Db;
  return { db, calls };
}

test("leaf edits preserve every container and exact flat projection before the SQL update", async () => {
  const nodes = parseDocContainers(
    "> - Words ^words\n>\n>   Other ^other\n^outer",
    { anchors: true },
  );
  const blocks = docContainerBlocks(nodes).map((block) =>
    block.id === "words" ? { ...block, text: "New" } : block,
  );
  const { db, calls } = fixture({ content_format: 2, content_nodes: nodes });
  await writeDocLeafEdits(db, "page", blocks);
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.match(calls[1].sql, /set_config/);
  const updated = JSON.parse(calls[2].values![2] as string);
  assert.equal(updated[0].id, "outer");
  assert.equal(updated[0].children[0].kind, "list");
  assert.deepEqual(docContainerBlocks(updated), blocks);
  assert.deepEqual(JSON.parse(calls[2].values![1] as string), blocks);
  assert.deepEqual(
    docContainerBlocks(nodes).map((block) =>
      "text" in block ? block.text : "",
    ),
    ["Words", "Other"],
  );
});

test("removed, inserted, reordered and renamed leaves refuse before writer authorization", async () => {
  const nodes = parseDocContainers("> One ^one\n>\n> Two ^two", {
    anchors: true,
  });
  const blocks = docContainerBlocks(nodes);
  for (const changed of [
    blocks.slice(1),
    [...blocks, { type: "paragraph" as const, text: "New" }],
    blocks.slice().reverse(),
    blocks.map((block) => ({ ...block, id: "renamed" })),
  ]) {
    const { db, calls } = fixture({ content_format: 2, content_nodes: nodes });
    await assert.rejects(
      writeDocLeafEdits(db, "page", changed),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 409,
    );
    assert.equal(calls.length, 1);
  }
});

test("typed invalid leaf edits and missing pages cannot authorize a write", async () => {
  const nodes = parseDocContainers("> Words ^words", { anchors: true });
  const { db, calls } = fixture({ content_format: 2, content_nodes: nodes });
  await assert.rejects(
    writeDocLeafEdits(db, "page", [
      { type: "paragraph", id: "words", text: "x".repeat(10001) },
    ]),
  );
  assert.equal(calls.length, 1);
  const missing = fixture(null);
  await assert.rejects(
    writeDocLeafEdits(missing.db, "missing", []),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
  assert.equal(missing.calls.length, 1);
});

test("legacy leaf edits keep the existing flat format without enabling the structured writer", async () => {
  const blocks = [{ type: "paragraph" as const, id: "words", text: "Legacy" }];
  const { db, calls } = fixture({ content_format: 1, content_nodes: null });
  await writeDocLeafEdits(db, "page", blocks);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1].sql, /content_nodes|set_config/);
  assert.deepEqual(JSON.parse(calls[1].values![1] as string), blocks);
});
