import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";

// Run the actual route registration and handlers with isolated DB/ACL transports.
const source = readFileSync(
  new URL("../src/modules/home/routes.ts", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "routes.ts",
  source,
  ts.ScriptTarget.ES2022,
  true,
);
const compiled = ts.transpileModule(
  ast.statements
    .filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(ast))
    .join("\n"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
async function fixture(format: 1 | 2) {
  const document =
    format === 2
      ? {
          format: 2,
          nodes: core.parseDocContainers(
            "> ## Reflection\n> Unrelated\n\n## Reflection\nExisting\n\n> ## Nested\n> Kept\n\n## Next\nOther",
          ),
        }
      : {
          format: 1,
          blocks: core.parseDoc("## Reflection\nExisting\n\n## Next\nOther"),
        };
  const handlers = new Map<string, any>(),
    reads: any[] = [],
    writes: any[] = [];
  const exports: any = {},
    db = { query: async () => ({ rows: [] }) };
  runInNewContext(compiled, {
    exports,
    ...core,
    pool: db,
    reader: () => db,
    authenticate: async () => ({ id: "owner" }),
    dayZoneFor: async () => "UTC",
    docVisibleTo: () => "true",
    listGoals: async () => [],
    listAgentRoutines: async () => [],
    todaysAgendaIfWritten: async () => ({
      id: "agenda",
      content: [{ type: "paragraph", text: "Unsafe flat projection" }],
    }),
    writeTodaysAgenda: async () => ({ doc: { id: "agenda" } }),
    readVersionedDoc: async (
      _db: any,
      user: any,
      id: string,
      supported: number[],
    ) => {
      reads.push({ user: user.id, id, supported: Array.from(supported) });
      // This stands for the visibility/privacy projected result, never the raw write callback.
      return { document };
    },
    addToPage: async (_u: any, id: string, flat: any, nested: any) => {
      const next =
        format === 2
          ? nested(document)
          : { format: 1, blocks: flat(document.blocks) };
      writes.push({ id, next });
    },
    writeRateLimit: {},
  });
  await exports.homeRoutes({
    get: (path: string, handler: any) => handlers.set("GET " + path, handler),
    post: (path: string, _options: any, handler: any) =>
      handlers.set("POST " + path, handler),
  });
  return { handlers, reads, writes };
}
for (const format of [1, 2] as const) {
  test(`Home reflection reads authorized format ${format} rather than flat agenda projection`, async () => {
    const f = await fixture(format);
    const result = await f.handlers.get("GET /me/home")({ headers: {} });
    assert.deepEqual(
      Array.from(result.reflection),
      format === 2 ? ["Existing", "Nested", "Kept"] : ["Existing"],
    );
    assert.deepEqual(f.reads, [
      { user: "owner", id: "agenda", supported: [1, 2] },
    ]);
  });
  test(`reflection append preserves format ${format} and returns authorized saved content`, async () => {
    const f = await fixture(format);
    let status = 0;
    const result = await f.handlers.get("POST /me/home/reflection")(
      { body: { text: "  New   line  " } },
      {
        code: (code: number) => {
          status = code;
        },
      },
    );
    assert.equal(status, 201);
    assert.equal(f.writes[0].next.format, format);
    const leaves =
      format === 2
        ? core.docContainerSectionBlocks(f.writes[0].next.nodes, "Reflection")
        : f.writes[0].next.blocks;
    assert.ok(leaves.some((block: any) => block.text === "New line"));
    // Mocked authorized reread intentionally differs from raw write, proving response provenance.
    assert.equal(result.reflection.includes("New line"), false);
    assert.equal(f.reads.length, 1);
  });
}
test("invalid reflection input rejects before page creation/write", async () => {
  const f = await fixture(2);
  await assert.rejects(
    f.handlers.get("POST /me/home/reflection")(
      { body: { text: "" } },
      { code() {} },
    ),
  );
  assert.equal(f.writes.length, 0);
  assert.equal(f.reads.length, 0);
});
