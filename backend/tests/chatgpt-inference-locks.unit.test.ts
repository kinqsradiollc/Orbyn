import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function actualJobGuard() {
  const source = readFileSync(
    new URL("../src/modules/auth/chatgpt-inference.ts", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "inference.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "jobLive",
  );
  assert.ok(declaration, "execute the actual production job guard");
  const calls: string[] = [];
  const context = {
    exports: {} as Record<string, any>,
    require: (path: string) => {
      if (path.endsWith("chat-maintenance.js"))
        return {
          guardChatMaintenanceJob: async () => calls.push("maintenance"),
        };
      if (path.endsWith("agenda-call.js"))
        return { guardAgendaInferenceJob: async () => calls.push("agenda") };
      if (path.endsWith("maintenance-inference.js"))
        return { guardPageInferenceJob: async () => calls.push("page") };
      throw new Error(`Unexpected import: ${path}`);
    },
    assistantJobSourcesVisible: () => "true",
    assertJobAiProviderChoice: async () => calls.push("choice"),
    fail: (statusCode: number, message: string) => {
      throw Object.assign(new Error(message), { statusCode });
    },
  };
  const compiled = ts.transpileModule(
    `${declaration.getText(ast)}\nexports.jobLive = jobLive;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  runInNewContext(compiled, context);
  return { run: context.exports.jobLive, calls };
}

test("inference job authority takes a write-compatible job lock before any request-row lock", async () => {
  const guard = actualJobGuard();
  const queries: string[] = [];
  await guard.run(
    {
      query: async (sql: string) => {
        queries.push(sql);
        guard.calls.push("lock");
        return { rowCount: 1 };
      },
    },
    "owner",
    "job",
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0], /FOR (?:NO KEY )?UPDATE OF j\s*$/);
  assert.deepEqual(guard.calls, [
    "agenda",
    "page",
    "lock",
    "maintenance",
    "choice",
  ]);
});

test("exclusive job authority still rejects changed jobs before provider consent", async () => {
  const guard = actualJobGuard();
  await assert.rejects(
    guard.run({ query: async () => ({ rowCount: 0 }) }, "owner", "job"),
    (error: any) => error.statusCode === 409,
  );
  assert.deepEqual(guard.calls, ["agenda", "page"]);
});
