import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";
const sourceText = readFileSync(
  new URL("../src/modules/docs/structure.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "structure.ts",
  sourceText,
  ts.ScriptTarget.ES2022,
  true,
);
const body = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "mergePages",
)!;
const compiled = ts.transpileModule(body.getText(ast), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const from = "11111111-1111-4111-8111-111111111111",
  into = "22222222-2222-4222-8222-222222222222";
async function fixture(
  options: { version?: number; space?: string; forbidden?: boolean } = {},
) {
  const sourceNodes = core.parseDocContainers("> Nested ^shared\n^owner", {
    anchors: true,
  });
  const linkedNodes = core.parseDocContainers(
    `> [Read](orbyn://doc/${from}#shared) ^reference\n^link-owner`,
    { anchors: true },
  );
  const events: string[] = [],
    writes: any[] = [],
    transfers: any[] = [];
  const rows = [
    {
      id: from,
      title: "Source",
      content_format: 2,
      content_nodes: sourceNodes,
    },
    {
      id: into,
      title: "Target",
      content_format: 1,
      content: [{ type: "paragraph", id: "shared", text: "Destination" }],
    },
  ];
  const db = {
    query: async (sql: string, values: any[]) => {
      if (sql.startsWith("SELECT id, title")) return { rows };
      if (sql.includes("SELECT d.id, d.content,"))
        return {
          rows: [
            {
              id: "linked",
              content_format: 2,
              content_nodes: linkedNodes,
              version: 4,
            },
          ],
        };
      if (sql.includes("UPDATE docs SET deleted_at")) {
        events.push("trash");
        return { rows: [] };
      }
      throw new Error("Unexpected SQL " + sql);
    },
  };
  const exports: any = {};
  let sequence = 0;
  runInNewContext(compiled, {
    exports,
    ...core,
    actAs: async () => {},
    newBlockId: () => `fresh-${++sequence}`,
    requireDoc: async (_db: any, id: string) => {
      if (options.forbidden) core.fail(403, "Read only");
      return {
        id,
        version: id === from ? 3 : 7,
        team_id: id === from ? (options.space ?? null) : null,
      };
    },
    allowPageFiles: async () => events.push("files"),
    filesOf: () => [],
    carryLines: async (...args: any[]) => {
      events.push("carry");
      transfers.push(args);
    },
    snapshot: async () => events.push("snapshot"),
    saveVersionedDoc: async (
      _db: any,
      _u: any,
      id: string,
      version: number,
      document: any,
      supported: any,
    ) => {
      events.push("save");
      writes.push({ id, version, document, supported: Array.from(supported) });
      return { id, version: version + 1 };
    },
    writableOwned: () => "true",
    noteTrash: async () => {},
    searchTrash: async () => {},
    readDoc: async () => ({ id: into, version: 8 }),
  });
  const run = () =>
    exports.mergePages(db, { id: "user" }, from, {
      into,
      version: options.version ?? 3,
    });
  return { run, events, writes, transfers, sourceNodes, linkedNodes };
}
test("page merge uses exact versioned writes and retains structured relinked owners", async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.version, 8);
  assert.deepEqual(f.events, ["files", "carry", "save", "save", "trash"]);
  assert.equal(f.writes[0].version, 7);
  assert.deepEqual(f.writes[0].supported, [1, 2]);
  assert.equal(f.writes[0].document.format, 2);
  const moved = f.writes[0].document.nodes.at(-1);
  assert.equal(moved.kind, "quote");
  assert.equal(moved.id, "owner");
  assert.equal(moved.children[0].block.id, "fresh-1");
  assert.equal(f.transfers[0][4].get("shared"), "fresh-1");
  assert.equal(f.writes[1].id, "linked");
  assert.equal(f.writes[1].version, 4);
  assert.equal(f.writes[1].document.nodes[0].id, "link-owner");
  assert.equal(
    f.writes[1].document.nodes[0].children[0].block.text,
    `[Read](orbyn://doc/${into}#fresh-1)`,
  );
  assert.equal(f.linkedNodes[0].kind, "quote");
});
for (const [options, code] of [
  [{ version: 2 }, 409],
  [{ space: "other-team" }, 422],
  [{ forbidden: true }, 403],
] as const) {
  test(`merge authority/revision rejection ${code} precedes writes and transfers`, async () => {
    const f = await fixture(options);
    await assert.rejects(f.run(), (error: any) => error.statusCode === code);
    assert.equal(f.writes.length, 0);
    assert.equal(f.transfers.length, 0);
    assert.equal(f.events.length, 0);
  });
}
