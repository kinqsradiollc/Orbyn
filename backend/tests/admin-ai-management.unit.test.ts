import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../../mobile/src/screens/AdminAi.tsx", import.meta.url),
  "utf8",
);
const tree = ts.createSourceFile(
  "AdminAi.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function attribute(tag: string, name: string, title?: string) {
  let found: string | undefined;
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(tree) === tag
    ) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const label = attrs.find((a) => a.name.getText(tree) === "title");
      if (
        !title ||
        label?.initializer?.getText(tree) === JSON.stringify(title)
      ) {
        const value = attrs.find(
          (a) => a.name.getText(tree) === name,
        )?.initializer;
        if (value && ts.isJsxExpression(value) && value.expression)
          found = value.expression.getText(tree);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `${tag}.${name} must exist`);
  return found;
}
function evaluate(expression: string, context: object) {
  const exports: any = {};
  const compiled = ts.transpileModule(`exports.value = (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports, ...context });
  return exports.value;
}

test("mobile provider management uses a busy-disabled menu and deferred actions", () => {
  const calls: string[] = [];
  const actions = evaluate(attribute("MoreMenu", "actions"), {
    onEdit: () => calls.push("edit"),
    onDelete: () => calls.push("delete"),
  });
  assert.equal(actions.length, 2);
  assert.equal(actions[0].label, "Edit connection");
  assert.equal(actions[1].label, "Delete connection");
  assert.equal(actions[1].destructive, true);
  assert.equal(
    evaluate(attribute("MoreMenu", "disabled"), { busy: true }),
    true,
  );
  assert.equal(calls.length, 0);
  actions[0].onPress();
  actions[1].onPress();
  assert.deepEqual(calls, ["edit", "delete"]);
  assert.equal(source.includes('<SmallAction label="Edit"'), false);
});

for (const operation of ["delete", "turn-off"] as const) {
  test(`${operation} provider action mutates only after explicit confirmation`, async () => {
    let pending: (() => Promise<void>) | undefined;
    const calls: unknown[] = [];
    const context = {
      p: { id: "selected-provider", name: "Fixture" },
      confirmAction: (
        _title: string,
        _message: string,
        _label: string,
        callback: () => Promise<void>,
      ) => {
        pending = callback;
      },
      run: async (fn: () => Promise<void>) => fn(),
      act: async (fn: () => Promise<void>) => fn(),
      setSettings: (value: unknown) => calls.push(value),
      client: {
        deleteAiProvider: async (id: string) => {
          calls.push(id);
        },
        updateAiSettings: async (value: unknown) => value,
      },
    };
    const expression =
      operation === "delete"
        ? attribute("ProviderRow", "onDelete")
        : attribute("Button", "onPress", "Turn off assistant");
    evaluate(expression, context)();
    assert.equal(calls.length, 0);
    assert.ok(pending);
    await pending();
    assert.equal(calls.length, 1);
    if (operation === "delete") assert.equal(calls[0], "selected-provider");
    else assert.equal((calls[0] as any).provider_id, null);
  });
}

for (const platform of ["web", "ios"] as const) {
  test(`${platform} confirmation helper waits for approval and supports cancellation`, async () => {
    const exports: any = {};
    let accept = false,
      mutations = 0;
    let nativeButtons: any[] = [];
    const compiled = ts.transpileModule(
      await readFile(
        new URL("../../mobile/src/lib/confirm.ts", import.meta.url),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    runInNewContext(compiled, {
      exports,
      globalThis: { confirm: () => accept },
      require: () => ({
        Platform: { OS: platform },
        Alert: {
          alert: (_t: string, _m: string, buttons: any[]) => {
            nativeButtons = buttons;
          },
        },
      }),
    });
    exports.confirmAction("Delete?", "Fixture", "Delete", () => {
      mutations++;
    });
    assert.equal(mutations, 0);
    if (platform === "ios") {
      assert.equal(nativeButtons[0].style, "cancel");
      nativeButtons[1].onPress();
    } else {
      accept = true;
      exports.confirmAction("Delete?", "Fixture", "Delete", () => {
        mutations++;
      });
    }
    assert.equal(mutations, 1);
  });
}
