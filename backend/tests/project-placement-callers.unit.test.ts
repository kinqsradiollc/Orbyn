import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import ts from "typescript";

const paths = {
  desktopTask: "desktop/src/features/task/TaskDetail.tsx",
  mobileTask: "mobile/src/screens/TaskDetail.tsx",
  desktopProject: "desktop/src/features/projects/ProjectDetail.tsx",
  mobileProject: "mobile/src/screens/docs/ProjectsSheet.tsx",
  desktopRecords: "desktop/src/features/projects/ProjectRecords.tsx",
  mobileRecords: "mobile/src/screens/docs/ProjectRecords.tsx",
};
function source(path: string) {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function callback(
  path: string,
  name: string,
  context: Record<string, unknown>,
) {
  const tree = source(path);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, `Exercise actual ${name}`);
  return runInNewContext(
    transformSync(`(${expression.getText(tree)})`, {
      loader: "tsx",
      target: "es2022",
    }).code,
    context,
  );
}
const conflict = () =>
  Object.assign(new Error("Task changed"), { status: 409 });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const platform of ["desktop", "mobile"] as const) {
  test(`${platform} task placement sends the shown detail version, retains conflict choice, and awaits explicit retry`, async () => {
    let fail = true;
    const requests: Array<{ id: string; input: Record<string, unknown> }> = [];
    let attempt: any = null;
    let reloads = 0;
    let pending: Promise<unknown> | undefined;
    const item = { id: "task", version: 2, status: "todo" };
    const context: Record<string, any> = {
      item,
      detail: { ...item, version: 7, attendees: [], links: [] },
      contextRead: { current: 0 },
      mounted: { current: true },
      owns: () => true,
      setPlacementRetry: (value: unknown) => {
        attempt = value;
      },
      setRetry: () => {
        reloads++;
      },
      setContextRetry() {},
      setContextFailure() {},
      setContext() {},
      setDetail() {},
      run: (work: () => Promise<unknown>) => {
        pending = work().catch(() => {
          reloads++;
        });
      },
      client: {
        setItemProject: async (id: string, input: Record<string, unknown>) => {
          requests.push({ id, input });
          if (fail) throw conflict();
          return { ok: true, item: { ...item, ...input, version: 9 } };
        },
        itemContext: async () => ({}),
      },
    };
    const fn = callback(
      platform === "desktop" ? paths.desktopTask : paths.mobileTask,
      platform === "desktop" ? "moveToProject" : "putInProject",
      context,
    );
    if (platform === "desktop")
      await assert.rejects(
        fn({ project_id: "chosen", stage_id: "stage" }),
        /changed/,
      );
    else {
      fn("chosen", "stage");
      await pending;
    }
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input.version, 7);
    assert.equal(requests[0].input.project_id, "chosen");
    assert.equal(attempt.version, 7);
    assert.equal(
      platform === "desktop" ? attempt.stage_id : attempt.stageId,
      "stage",
    );
    assert.equal(reloads, 1);
    await tick();
    assert.equal(
      requests.length,
      1,
      "Read refresh never replays a placement write",
    );
    fail = false;
    context.detail = { ...context.detail, version: 8 };
    if (platform === "desktop") await fn(attempt);
    else {
      fn(attempt.projectId, attempt.stageId);
      await pending;
    }
    assert.equal(requests.length, 2);
    assert.equal(requests[1].input.version, 8);
    assert.equal(requests[1].input.stage_id, "stage");
    assert.equal(attempt, null);
  });
}

for (const platform of ["desktop", "mobile"] as const) {
  for (const operation of ["moveTo", "unfile"]) {
    test(`${platform} project ${operation} sends the displayed version and preserves a conflict without replay`, async () => {
      const requests: Record<string, unknown>[] = [];
      let attempt: any = null;
      let refreshes = 0;
      let closed = false;
      let pending: Promise<unknown> | undefined;
      const context: Record<string, unknown> = {
        canWrite: true,
        canWriteIn: () => true,
        mutation: { current: false },
        mounted: { current: true },
        project: { id: "project" },
        open: { id: "project" },
        activeProject: { current: "project" },
        owns: () => true,
        unfiledPool: [],
        setBusy() {},
        report() {},
        setPlacementRetry: (value: unknown) => {
          attempt = value;
        },
        onItemsChanged: () => {
          refreshes++;
        },
        setMoving: () => {
          closed = true;
        },
        run: (work: () => Promise<unknown>) => {
          pending = work().catch(() => {});
        },
        client: {
          setItemProject: async (
            _id: string,
            input: Record<string, unknown>,
          ) => {
            requests.push(input);
            throw conflict();
          },
        },
      };
      const fn = callback(
        platform === "desktop" ? paths.desktopProject : paths.mobileProject,
        operation,
        context,
      );
      const result = fn(
        { id: "task", project_id: "project", title: "Shown task", version: 11 },
        "stage",
      );
      if (platform === "mobile") await pending;
      else await result;
      await tick();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].version, 11);
      assert.equal(
        requests[0].project_id,
        operation === "unfile" ? null : "project",
      );
      assert.equal(attempt.version, 11);
      assert.equal(attempt.unfile, operation === "unfile");
      assert.equal(attempt.stageId, operation === "unfile" ? null : "stage");
      assert.equal(refreshes, 1);
      assert.equal(
        closed,
        false,
        "The choice sheet stays open after a rejected move",
      );
    });
  }
}

test("all former placement callers use expected versions or initial creation placement", () => {
  let placementCalls = 0;
  for (const path of Object.values(paths)) {
    const tree = source(path);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "setItemProject"
      ) {
        placementCalls++;
        const input = node.arguments[1];
        assert.ok(input && ts.isObjectLiteralExpression(input));
        assert.ok(
          input.properties.some(
            (property) => property.name?.getText(tree) === "version",
          ),
          `${path} supplies an expected version`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.equal(
    placementCalls,
    6,
    "Two decision-task placements move into initial creation",
  );
  for (const path of [paths.desktopRecords, paths.mobileRecords]) {
    const tree = source(path);
    let projectCreate = false;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "createItem"
      ) {
        const input = node.arguments[0];
        if (input && ts.isObjectLiteralExpression(input))
          projectCreate ||= input.properties.some(
            (property) => property.name?.getText(tree) === "project_id",
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    assert.ok(
      projectCreate,
      `${path} creates the decision's task into its project atomically`,
    );
  }
});
