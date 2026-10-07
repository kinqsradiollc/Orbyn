import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const sources = await Promise.all(
  [
    "../../desktop/src/features/admin/AdminAi.tsx",
    "../../mobile/src/screens/AdminAi.tsx",
    "../../packages/api-client/src/client.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
);
const trees = sources.map((source, index) =>
  ts.createSourceFile(
    index === 2 ? "client.ts" : "AdminAi.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    index === 2 ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  ),
);
const evaluate = (expression: string, context: object) => {
  const exports: any = {};
  runInNewContext(
    ts.transpileModule(`exports.value=(${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, ...context },
  );
  return exports.value;
};
function extract(
  tree: ts.SourceFile,
  predicate: (n: ts.Node) => string | undefined,
) {
  let value: string | undefined;
  function visit(n: ts.Node) {
    value = predicate(n) ?? value;
    ts.forEachChild(n, visit);
  }
  visit(tree);
  assert.ok(value);
  return value;
}
const web = extract(trees[0], (n) =>
  ts.isVariableDeclaration(n) && n.name.getText(trees[0]) === "test"
    ? n.initializer?.getText(trees[0])
    : undefined,
);
const mobile = extract(trees[1], (n) => {
  if (
    !ts.isJsxSelfClosingElement(n) ||
    n.tagName.getText(trees[1]) !== "SmallAction"
  )
    return;
  const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
  if (
    !attrs
      .find((a) => a.name.getText(trees[1]) === "label")
      ?.initializer?.getText(trees[1])
      .includes("Test connection")
  )
    return;
  const value = attrs.find(
    (a) => a.name.getText(trees[1]) === "onPress",
  )?.initializer;
  return value && ts.isJsxExpression(value)
    ? value.expression?.getText(trees[1])
    : undefined;
});
for (const platform of ["web", "mobile"] as const) {
  for (const scenario of [
    "current",
    "same-timestamp",
    "unmounted",
    "wrong-receipt",
    "wrong-model",
    "missing-receipt",
  ] as const) {
    test(`${platform} probe ${scenario} binds model and exact connection generation`, async () => {
      const p = { id: "p", updated_at: "same", controls_revision: "7" };
      const dataRef: { current: { providers: (typeof p)[] } | null } = {
        current: { providers: [{ ...p }] },
      };
      const providerRevision: { current: string | null } = { current: "same" };
      const providerGeneration: { current: string | null } = { current: "7" };
      let pending: Promise<void> | undefined;
      let resolve!: (result: any) => void;
      const published: any[] = [];
      const callback = evaluate(platform === "web" ? web : mobile, {
        p,
        dataRef,
        providerRevision,
        providerGeneration,
        typed: "chosen-model",
        modelFor: () => " chosen-model ",
        act: (fn: () => Promise<void>) => {
          pending = fn();
        },
        client: {
          testAiProvider: (id: string, model: string, revision: string) => {
            assert.equal(id, "p");
            assert.equal(model, "chosen-model");
            assert.equal(revision, "7");
            return new Promise((r) => {
              resolve = r;
            });
          },
        },
        setTests: (fn: (previous: object) => object) => {
          const result = fn({});
          if (Object.keys(result).length) published.push(result);
        },
        setTest: (result: any) => {
          if (result) published.push(result);
        },
      });
      if (platform === "web") callback(p);
      else callback();
      if (scenario === "same-timestamp") {
        dataRef.current!.providers[0].controls_revision = "8";
        providerGeneration.current = "8";
      }
      if (scenario === "unmounted") {
        dataRef.current = null;
        providerRevision.current = null;
        providerGeneration.current = null;
      }
      resolve({
        ok: true,
        latency_ms: 1,
        message: "Inert receipt",
        ...(scenario === "missing-receipt"
          ? {}
          : {
              provider_revision: scenario === "wrong-receipt" ? "8" : "7",
              model:
                scenario === "wrong-model" ? "other-model" : "chosen-model",
            }),
      });
      await pending;
      assert.equal(published.length, scenario === "current" ? 1 : 0);
    });
  }
  test(`${platform} probe with missing displayed revision does not dispatch`, async () => {
    let calls = 0;
    let pending: Promise<void> | undefined;
    const callback = evaluate(platform === "web" ? web : mobile, {
      p: { id: "p", updated_at: "same" },
      typed: "chosen-model",
      modelFor: () => "chosen-model",
      act: (fn: () => Promise<void>) => {
        pending = fn();
      },
      client: {
        testAiProvider: () => {
          calls++;
        },
      },
      setTests: () => {},
      setTest: () => {},
    });
    if (platform === "web") callback({ id: "p", updated_at: "same" });
    else callback();
    await pending;
    assert.equal(calls, 0);
  });
}
const webDisplay = extract(trees[0], (n) =>
  ts.isVariableDeclaration(n) &&
  n.name.getText(trees[0]) === "result" &&
  n.initializer?.getText(trees[0]).includes("tests[p.id]")
    ? n.initializer.getText(trees[0])
    : undefined,
);
const mobileDisplay = extract(trees[1], (n) =>
  ts.isJsxExpression(n) &&
  n.expression &&
  ts.isBinaryExpression(n.expression) &&
  n.expression.getText(trees[1]).includes("test.provider_revision")
    ? n.expression.left.getText(trees[1])
    : undefined,
);
for (const platform of ["web", "mobile"] as const)
  test(`${platform} rendered probe cannot certify a different model draft or generation`, () => {
    for (const [revision, model, receipt, expected] of [
      ["7", "chosen-model", "7", true],
      ["8", "chosen-model", "7", false],
      ["7", "other-model", "7", false],
      [undefined, "chosen-model", undefined, false],
    ] as const) {
      const result = {
        model: "chosen-model",
        provider_revision: receipt,
        ok: true,
      };
      const value = evaluate(platform === "web" ? webDisplay : mobileDisplay, {
        p: { id: "p", controls_revision: revision },
        model,
        typed: model,
        tests: { p: result },
        test: result,
      });
      assert.equal(Boolean(value), expected);
    }
  });
test("API client retains legacy probe calls and sends explicit generation when supplied", () => {
  const method = extract(trees[2], (n) =>
    ts.isMethodDeclaration(n) && n.name.getText(trees[2]) === "testAiProvider"
      ? n.getText(trees[2])
      : undefined,
  );
  const callback = evaluate(`({${method}}).testAiProvider`, {});
  for (const model of [undefined, "chosen-model"])
    for (const revision of [undefined, "7"]) {
      let request: any;
      callback.call(
        {
          request: (url: string, options: any) => {
            request = { url, options };
          },
        },
        "selected",
        model,
        revision,
      );
      assert.equal(request.url, "/ai/providers/selected/test");
      assert.equal(request.options.method, "POST");
      assert.equal(
        JSON.stringify(request.options.body),
        JSON.stringify({
          ...(model ? { model } : {}),
          ...(revision ? { expected_revision: revision } : {}),
        }),
      );
    }
});
