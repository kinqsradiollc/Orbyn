import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";

// Exercise the actual Home handler, isolating the database and external services.
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
async function fixture(
  _format: 1 | 2,
  plans: {
    goals?: any[];
    documents?: any[];
    tasks?: any[];
    projects?: any[];
  },
) {
  const handlers = new Map<string, any>(),
    reads: any[] = [];
  const exports: any = {},
    db = {
      query: async (sql: string, values: any[]) => {
        if (sql.includes("SELECT d.id, d.content, d.content_format"))
          return { rows: plans.documents ?? [] };
        if (sql.includes("SELECT l.doc_id,l.block_id,i.status")) {
          reads.push({ taskPlans: Array.from(values[0]) });
          return { rows: plans.tasks ?? [] };
        }
        if (sql.includes("SELECT p.id,")) return { rows: plans.projects ?? [] };
        return { rows: [] };
      },
    };
  runInNewContext(compiled, {
    exports,
    ...core,
    pool: db,
    reader: () => db,
    authenticate: async () => ({ id: "owner" }),
    dayZoneFor: async () => "UTC",
    docVisibleTo: () => "true",
    listGoals: async (_db: any, user: string, ai: boolean) => {
      assert.equal(user, "owner");
      assert.equal(ai, true);
      return plans.goals ?? [];
    },
    listAgentRoutines: async () => [],
    todaysAgendaIfWritten: async () => null,
    writeRateLimit: {},
  });
  await exports.homeRoutes({
    get: (path: string, handler: any) => handlers.set("GET " + path, handler),
    post: () => {},
  });
  return { handlers, reads };
}
const activeGoal = (
  id: string,
  plan: string | null,
  project: string | null = null,
) => ({
  id,
  title: id,
  status: "active",
  plan_doc_id: plan,
  project_id: project,
});
test("Home goal progress counts nested steps and current task state independently per plan", async () => {
  const f = await fixture(2, {
    goals: [activeGoal("nested", "a"), activeGoal("flat", "b")],
    documents: [
      {
        id: "a",
        content_format: 2,
        content_nodes: core.parseDocContainers(
          "> - [ ] Linked ^same\n> - [x] Local\n> - Plain words",
          { anchors: true },
        ),
      },
      {
        id: "b",
        content_format: 1,
        content: [
          { type: "todo", id: "same", text: "Reopened elsewhere", done: true },
        ],
      },
    ],
    tasks: [
      { doc_id: "a", block_id: "same", status: "done" },
      { doc_id: "b", block_id: "same", status: "todo" },
    ],
  });
  const result = await f.handlers.get("GET /me/home")({ headers: {} });
  assert.equal(result.goals[0].progress, 1);
  assert.equal(result.goals[0].progress_label, "2 of 2 steps");
  assert.equal(result.goals[1].progress, 0);
  assert.equal(result.goals[1].progress_label, "0 of 1 steps");
  assert.deepEqual(
    f.reads.filter((r) => r.taskPlans),
    [{ taskPlans: ["a", "b"] }],
  );
});
test("Home progress keeps project totals authoritative and ignores unavailable plan documents", async () => {
  const f = await fixture(2, {
    goals: [
      activeGoal("project", "visible", "project"),
      activeGoal("private", "hidden"),
      { ...activeGoal("finished", null), status: "done" },
    ],
    documents: [
      {
        id: "visible",
        content_format: 2,
        content_nodes: core.parseDocContainers("- [x] Local"),
      },
    ],
    projects: [{ id: "project", done: 1, total: 4 }],
  });
  const result = await f.handlers.get("GET /me/home")({ headers: {} });
  assert.equal(result.goals.length, 2);
  assert.equal(result.goals[0].progress, 0.25);
  assert.equal(result.goals[0].progress_label, "1 of 4 tasks");
  assert.equal(result.goals[1].progress, null);
  assert.equal(result.goals[1].progress_label, null);
  assert.equal(f.reads.filter((r) => r.taskPlans).length, 0);
});
test("Home progress does not invent steps for empty or prose-only nested plans", async () => {
  const f = await fixture(2, {
    goals: [activeGoal("empty", "empty"), activeGoal("prose", "prose")],
    documents: [
      { id: "empty", content_format: 2, content_nodes: [] },
      {
        id: "prose",
        content_format: 2,
        content_nodes: core.parseDocContainers("> Words\n> - Plain list"),
      },
    ],
  });
  const result = await f.handlers.get("GET /me/home")({ headers: {} });
  assert.ok(
    result.goals.every(
      (goal: any) => goal.progress === null && goal.progress_label === null,
    ),
  );
  assert.equal(f.reads.filter((r) => r.taskPlans).length, 0);
});
