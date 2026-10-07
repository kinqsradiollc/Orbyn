import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function evaluate(expression: string, context: object) {
  const exports: any = {};
  runInNewContext(
    ts.transpileModule(`exports.value = (${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, ...context },
  );
  return exports.value;
}
const webSource = await readFile(
  new URL("../../desktop/src/features/admin/AdminAi.tsx", import.meta.url),
  "utf8",
);
const webTree = ts.createSourceFile(
  "AdminAi.tsx",
  webSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function webCallback(name: string) {
  let expression: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(webTree) === name &&
      node.initializer
    )
      expression = node.initializer.getText(webTree);
    ts.forEachChild(node, visit);
  }
  visit(webTree);
  assert.ok(expression);
  return expression;
}
for (const scenario of ["current", "revised", "deleted"] as const) {
  test(`web catalog ${scenario} preserves model choice and rejects stale results`, async () => {
    let pending: Promise<void> | undefined;
    let resolve!: (result: { models: string[] }) => void;
    let catalogs: Record<string, string[]> = {};
    let changes = 0;
    const dataRef = { current: { providers: [{ id: "p", updated_at: "v1" }] } };
    const loadModels = evaluate(webCallback("loadModels"), {
      act: (fn: () => Promise<void>) => {
        pending = fn();
      },
      client: {
        listAiModels: (id: string, revision: string) => {
          assert.equal(id, "p");
          assert.equal(revision, "7");
          return new Promise((r) => {
            resolve = r;
          });
        },
      },
      dataRef,
      models: {},
      modelFor: () => "saved-unlisted-model",
      setModels: () => changes++,
      setLoaded: (fn: (value: typeof catalogs) => typeof catalogs) => {
        catalogs = fn(catalogs);
      },
    });
    loadModels({ id: "p", updated_at: "v1", controls_revision: "7" });
    if (scenario === "revised") dataRef.current.providers[0].updated_at = "v2";
    if (scenario === "deleted") dataRef.current.providers = [];
    resolve({ models: ["first-other-model"] });
    await pending;
    assert.equal(changes, 0);
    assert.deepEqual(
      Object.keys(catalogs),
      scenario === "current" ? ["p"] : [],
    );
  });
}

const mobileSource = await readFile(
  new URL("../../mobile/src/screens/AdminAi.tsx", import.meta.url),
  "utf8",
);
const mobileTree = ts.createSourceFile(
  "AdminAi.tsx",
  mobileSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function mobileCallback(label: string) {
  let expression: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(mobileTree) === "SmallAction"
    ) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const labelAttr = attrs.find(
        (a) => a.name.getText(mobileTree) === "label",
      );
      if (labelAttr?.initializer?.getText(mobileTree).includes(label)) {
        const value = attrs.find(
          (a) => a.name.getText(mobileTree) === "onPress",
        )?.initializer;
        if (value && ts.isJsxExpression(value) && value.expression)
          expression = value.expression.getText(mobileTree);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(mobileTree);
  assert.ok(expression);
  return expression;
}
for (const scenario of ["current", "revised", "unmounted"] as const) {
  test(`mobile catalog ${scenario} preserves model choice and rejects stale results`, async () => {
    let resolve!: (result: { models: string[] }) => void;
    let pending: Promise<void> | undefined;
    const providerRevision: { current: string | null } = { current: "v1" };
    let calls = 0;
    const callback = evaluate(mobileCallback("Load models"), {
      act: (fn: () => Promise<void>) => {
        pending = fn();
      },
      client: {
        listAiModels: (id: string, revision: string) => {
          assert.equal(id, "p");
          assert.equal(revision, "7");
          return new Promise((r) => {
            resolve = r;
          });
        },
      },
      p: { id: "p", updated_at: "v1", controls_revision: "7" },
      providerRevision,
      setModels: () => calls++,
    });
    callback();
    if (scenario !== "current")
      providerRevision.current = scenario === "unmounted" ? null : "v2";
    resolve({ models: ["first-other-model"] });
    await pending;
    assert.equal(calls, scenario === "current" ? 1 : 0);
  });
}

test("mobile follows saved model changes while preserving a manual draft", () => {
  let expression: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(mobileTree) === "useEffect" &&
      node.arguments[0]?.getText(mobileTree).includes("savedModel.current")
    )
      expression = node.arguments[0].getText(mobileTree);
    ts.forEachChild(node, visit);
  }
  visit(mobileTree);
  assert.ok(expression);
  for (const [initial, expected] of [
    ["saved", "updated"],
    ["manual", "manual"],
  ]) {
    let model = initial;
    const savedModel = { current: "saved" };
    evaluate(expression, {
      active: true,
      activeModel: "updated",
      savedModel,
      setModel: (fn: (value: string) => string) => {
        model = fn(model);
      },
    })();
    assert.equal(model, expected);
    assert.equal(savedModel.current, "updated");
  }
});

test("API client sends exact catalog generation without changing legacy calls", async () => {
  const source = await readFile(
    new URL("../../packages/api-client/src/client.ts", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "client.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let method: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(tree) === "listAiModels"
    )
      method = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(method);
  const callback = evaluate(`({ ${method} }).listAiModels`, {});
  for (const revision of [undefined, "7"]) {
    let request: { url: string; options: any } | undefined;
    callback.call(
      {
        request: (url: string, options: any) => {
          request = { url, options };
        },
      },
      "selected",
      revision,
    );
    assert.equal(request!.url, "/ai/providers/selected/models");
    assert.equal(request!.options.method, "POST");
    assert.equal(
      JSON.stringify(request!.options.body),
      JSON.stringify(revision ? { expected_revision: revision } : {}),
    );
  }
});
