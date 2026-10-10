import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";

// Compile the actual service function while isolating DB, ACL and event transports.
const source = readFileSync(
  new URL("../src/modules/docs/service.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "service.ts",
  source,
  ts.ScriptTarget.ES2022,
  true,
);
const body = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "addToPage",
)!;
const compiled = ts.transpileModule(body.getText(ast), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function fixture(format: 1 | 2, allowed = true) {
  const nodes = core.parseDocContainers("> Nested words ^words\n^outer", {
    anchors: true,
  });
  const content = core.docContainerBlocks(nodes);
  const events: string[] = [],
    saves: any[] = [],
    updates: any[] = [];
  const db = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.startsWith("SELECT content,")) {
        events.push("read");
        return {
          rows: [
            {
              content,
              content_format: format,
              content_nodes: nodes,
              version: 7,
            },
          ],
        };
      }
      if (sql.includes("UPDATE docs SET content")) {
        events.push("flat-write");
        updates.push(values);
        return { rows: [{ id: "page", title: "Page", version: 8 }] };
      }
      throw new Error("Unexpected SQL " + sql);
    },
  };
  const exports: any = {};
  runInNewContext(compiled, {
    exports,
    ...core,
    transaction: async (fn: any) => fn(db),
    actAs: async () => {
      events.push("actor");
    },
    requireDoc: async () => {
      events.push("permission");
      if (!allowed) core.fail(403, "Read only");
    },
    snapshot: async () => {
      events.push("flat-history");
    },
    pool: {},
    announceDocChange: async () => {
      events.push("announce");
    },
    syncSavedPages: async () => {
      events.push("study");
    },
    require: (name: string) => {
      assert.equal(name, "./content-format.js");
      return {
        saveVersionedDoc: async (...args: any[]) => {
          events.push("structured-save");
          saves.push(args);
          return { id: "page", title: "Page", version: 8 };
        },
      };
    },
  });
  return { run: exports.addToPage, nodes, content, events, saves, updates };
}
test("nested add routes through the capability writer with exact revision and owned tree", async () => {
  const f = fixture(2);
  let flatCalled = false;
  const result = await f.run(
    { id: "owner" },
    "page",
    () => {
      flatCalled = true;
      return [];
    },
    (document: any) => ({
      format: 2,
      nodes: core.appendDocContainerBlocks(document.nodes, [
        { type: "paragraph", text: "Added", id: "added" },
      ]),
    }),
  );
  assert.equal(flatCalled, false);
  assert.equal(f.updates.length, 0);
  assert.equal(f.saves.length, 1);
  const args = f.saves[0];
  assert.equal(args[2], "page");
  assert.equal(args[3], 7);
  assert.deepEqual(JSON.parse(JSON.stringify(args[5])), [1, 2]);
  assert.deepEqual(args[4].nodes.slice(0, -1), f.nodes);
  assert.equal(result.version, 8);
  assert.deepEqual(f.events, [
    "actor",
    "permission",
    "read",
    "structured-save",
    "announce",
    "study",
  ]);
});
test("nested writer absence, downgrade and read-only access reject before any write or event", async () => {
  for (const reason of ["missing", "downgrade", "read-only"] as const) {
    const f = fixture(2, reason !== "read-only");
    await assert.rejects(
      f.run(
        { id: "owner" },
        "page",
        () => [],
        reason === "missing" ? undefined : () => ({ format: 1, blocks: [] }),
      ),
      (error: any) =>
        error.statusCode ===
        (reason === "read-only" ? 403 : reason === "missing" ? 409 : 400),
    );
    assert.equal(f.saves.length, 0);
    assert.equal(f.updates.length, 0);
    assert.ok(!f.events.includes("announce"));
  }
});
test("legacy adds retain their flat callback and history path", async () => {
  const f = fixture(1);
  await f.run(
    { id: "owner" },
    "page",
    (blocks: core.DocBlock[]) => [
      ...blocks,
      { type: "paragraph", text: "Added" },
    ],
    () => {
      throw new Error("Unexpected nested callback");
    },
  );
  assert.equal(f.saves.length, 0);
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.events, [
    "actor",
    "permission",
    "read",
    "flat-history",
    "flat-write",
    "announce",
    "study",
  ]);
});
