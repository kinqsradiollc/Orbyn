import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";
function compile(path: string, names: string[]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "service.ts",
    source,
    ts.ScriptTarget.ES2022,
    true,
  );
  return ts.transpileModule(
    ast.statements
      .filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          names.includes(node.name?.text ?? ""),
      )
      .map((node) => node.getText(ast))
      .join("\n"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
}
const writerCode = compile("../src/modules/docs/content-format.ts", [
  "document",
  "capability",
  "readVersionedDoc",
  "saveVersionedDoc",
]);
const taskCode = compile("../src/modules/docs/service.ts", ["makeLineTasks"]);
const nodes = () =>
  core.parseDocContainers(
    "> - [ ] Open ^open\n> - [x] Finished ^finished\n> - Plain ^plain\n^owner",
    { anchors: true },
  );
function writerFixture() {
  const row: any = {
    id: "page",
    title: "Page",
    version: 7,
    content_format: 2,
    content_nodes: nodes(),
  };
  const calls: any[] = [],
    writes: any[] = [];
  const exports: any = {},
    db = {
      query: async (sql: string, values: any[]) => {
        if (sql.startsWith("SELECT d.id")) return { rows: [row] };
        if (sql.startsWith("SELECT set_config")) return { rows: [] };
        if (sql.startsWith("UPDATE docs SET content=")) {
          writes.push(values);
          row.content = JSON.parse(values[1]);
          row.content_nodes = JSON.parse(values[3]);
          row.version++;
          return { rows: [] };
        }
        throw new Error("Unexpected SQL " + sql);
      },
    };
  const tick = async (_db: any, _id: any, leaves: any[]) =>
    leaves.map((block) =>
      block.type === "todo" && block.id === "open"
        ? { ...block, done: true }
        : block,
    );
  runInNewContext(writerCode, {
    exports,
    ...core,
    VISIBLE: "true",
    requireDoc: async () => ({ version: row.version, content_format: 2 }),
    actAs: async () => {},
    withTaskState: tick,
    syncTicks: async (
      _db: any,
      _u: any,
      _id: any,
      leaves: any[],
      from: any,
    ) => {
      calls.push({ leaves, from });
      return tick(null, null, leaves);
    },
    linkPrivacy: async () => ({
      value: (leaves: any[]) =>
        leaves.map((block) =>
          block.id === "open" ? { ...block, text: "Private page" } : block,
        ),
    }),
    keepHiddenLabels: async (_db: any, _id: any, _u: any, leaves: any[]) =>
      leaves.map((block) =>
        block.id === "open" ? { ...block, text: "Stored original" } : block,
      ),
    allowPageFiles: async () => {},
    followComments: async () => {},
    followSuggestions: async () => {},
    snapshot: async () => {},
  });
  return { exports, db, row, calls, writes };
}
test("versioned read projects task status and privacy into owning checklist metadata", async () => {
  const f = writerFixture();
  const result = await f.exports.readVersionedDoc(
    f.db,
    { id: "user" },
    "page",
    [1, 2],
  );
  assert.equal(result.document.format, 2);
  const view = core.docContainerTaskBlocks(result.document.nodes);
  assert.deepEqual(
    view
      .filter((b) => b.type === "todo")
      .map((b: any) => [b.id, b.done, b.text]),
    [
      ["open", true, "Private page"],
      ["finished", true, "Finished"],
    ],
  );
  assert.ok(
    core
      .docContainerBlocks(result.document.nodes)
      .every((b) => b.type === "paragraph"),
  );
  assert.equal(
    core.docContainerTaskBlocks(f.row.content_nodes)[0].type,
    "todo",
  );
  assert.equal(
    (core.docContainerTaskBlocks(f.row.content_nodes)[0] as any).done,
    false,
  );
});
test("versioned save synchronizes synthetic task view but stores matching paragraph projection and full owners", async () => {
  const f = writerFixture();
  await f.exports.saveVersionedDoc(
    f.db,
    { id: "user" },
    "page",
    7,
    { format: 2, nodes: nodes() },
    [1, 2],
    6,
  );
  assert.equal(f.calls[0].from, 6);
  assert.equal(f.calls[0].leaves[0].type, "todo");
  assert.equal(f.calls[0].leaves[0].text, "Stored original");
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.row.content, core.docContainerBlocks(f.row.content_nodes));
  assert.ok(f.row.content.every((b: any) => b.type === "paragraph"));
  assert.equal(
    (core.docContainerTaskBlocks(f.row.content_nodes)[0] as any).done,
    true,
  );
  assert.equal(f.row.content_nodes[0].id, "owner");
});
function tasksFixture(format: 1 | 2, allowed = true, alreadyLinked = false) {
  const tree = nodes(),
    saves: any[] = [],
    created: any[] = [],
    links: any[] = [];
  const flat: any[] = [
    { type: "todo", text: "Open", done: false, id: "open" },
    { type: "todo", text: "Finished", done: true, id: "finished" },
  ];
  const db = {
    query: async (sql: string, values: any[]) => {
      if (sql.startsWith("SELECT content,"))
        return {
          rows: [
            {
              content_format: format,
              content: flat,
              content_nodes: tree,
              version: 7,
            },
          ],
        };
      if (sql.includes("SELECT block_id FROM doc_task_links"))
        return { rows: alreadyLinked ? [{ block_id: "open" }] : [] };
      if (sql.includes("INSERT INTO doc_task_links")) {
        links.push(values);
        return { rows: [] };
      }
      if (sql.startsWith("UPDATE docs SET content")) {
        saves.push({ flat: JSON.parse(values[1]) });
        return { rows: [] };
      }
      throw new Error("Unexpected SQL " + sql);
    },
  };
  const exports: any = {};
  runInNewContext(taskCode, {
    exports,
    ...core,
    randomUUID: () => "assigned",
    requireDoc: async (_db: any, _id: any, _u: any, permission: any) => {
      assert.equal(permission, "items:write");
      if (!allowed) core.fail(403, "Read only");
    },
    linkPrivacy: async () => ({
      line: (text: string) => ({ text: "Authorized " + text }),
    }),
    itemFromLine: (text: string) => ({ title: text }),
    mutate: async (_db: any, _u: any, input: any) => {
      created.push(input);
      return { id: "task" };
    },
    require: (name: string) => {
      assert.equal(name, "./content-format.js");
      return {
        saveVersionedDoc: async (
          _db: any,
          _u: any,
          id: string,
          version: number,
          document: any,
        ) => {
          saves.push({ id, version, document });
        },
      };
    },
  });
  const run = (only?: string[]) =>
    exports.makeLineTasks(
      db,
      { id: "user" },
      { id: "page", team_id: null },
      { only },
    );
  return { run, saves, created, links, tree };
}
for (const format of [1, 2] as const)
  test(`task creation format ${format} selects open checklists and preserves identity`, async () => {
    const f = tasksFixture(format);
    const result = await f.run(["open"]);
    assert.equal(result.length, 1);
    assert.equal(f.created[0].data.title, "Authorized Open");
    assert.equal(f.links[0][1], "open");
    if (format === 2) {
      assert.equal(f.saves[0].version, 7);
      assert.deepEqual(JSON.parse(JSON.stringify(f.saves[0].document)), {
        format: 2,
        nodes: f.tree,
      });
    } else assert.ok(f.saves[0].flat.some((b: any) => b.id === "open"));
  });
test("completed/plain/unknown checklist selection does not create tasks or save", async () => {
  const f = tasksFixture(2);
  assert.equal(await f.run(["finished", "plain", "missing"]), null);
  assert.equal(f.created.length, 0);
  assert.equal(f.saves.length, 0);
});
test("read-only task creation fails before task mutation or document write", async () => {
  const f = tasksFixture(2, false);
  await assert.rejects(f.run(), (error: any) => error.statusCode === 403);
  assert.equal(f.created.length, 0);
  assert.equal(f.saves.length, 0);
});

test("already linked nested checklist is not duplicated or rewritten", async () => {
  const f = tasksFixture(2, true, true);
  assert.equal(await f.run(["open"]), null);
  assert.equal(f.created.length, 0);
  assert.equal(f.saves.length, 0);
});
