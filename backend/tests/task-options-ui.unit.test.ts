import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isClosed } from "@orbyn/core";

function file(path: string) {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function find(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}
function evaluate(expression: ts.Node, page: ts.SourceFile, context: object) {
  const code = ts.transpileModule(`(${expression.getText(page)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return runInNewContext(code, context);
}
const web = file("../../desktop/src/features/task/TaskDetail.tsx");
const mobile = file("../../mobile/src/screens/TaskDetail.tsx");

function webMenu(context: object) {
  const popover = find(
    web,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(web) === "Popover",
  )[0];
  assert.ok(popover);
  let expression = popover.parent;
  while (ts.isParenthesizedExpression(expression))
    expression = expression.parent;
  assert.ok(ts.isBinaryExpression(expression));
  return evaluate(expression, web, {
    optionsAt: {},
    canWrite: true,
    current: { kind: "task", status: "todo", title: "Fixture" },
    pending: false,
    isClosed,
    Popover: "Popover",
    Ban: "Ban",
    React: {
      createElement: (
        type: unknown,
        props: object,
        ...children: unknown[]
      ) => ({ type, props: { ...props, children } }),
    },
    setOptionsAt: () => {},
    ask: async () => false,
    setStatus: () => {},
    ...context,
  }) as any;
}

test("web task cancel action is in options and the footer has no duplicate dismissal", () => {
  const cancel = find(
    web,
    (node) =>
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(web) === "button" &&
      node.children.some(
        (child) => ts.isJsxText(child) && child.text.trim() === "Cancel task",
      ),
  );
  assert.equal(cancel.length, 1);
  let parent: ts.Node | undefined = cancel[0];
  while (
    parent &&
    !(
      ts.isJsxElement(parent) &&
      parent.openingElement.tagName.getText(web) === "Popover"
    )
  )
    parent = parent.parent;
  assert.ok(parent, "Cancellation must be contained in the options popover");
  const close = find(
    web,
    (node) =>
      ts.isJsxAttribute(node) &&
      node.name.getText(web) === "onClick" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression?.getText(web) === "onClose",
  );
  assert.equal(close.length, 1);
});

test("web options respects viewer, event and closed-task guards and busy state", () => {
  assert.equal(webMenu({ canWrite: false }), false);
  for (const current of [
    { kind: "event", status: "todo" },
    { kind: "task", status: "done" },
    { kind: "task", status: "cancelled" },
  ])
    assert.equal(webMenu({ current }), false);
  const menu = webMenu({ pending: true });
  assert.equal(menu.props.children[0].props.children[0].props.disabled, true);
});

test("web cancellation closes options and requires affirmative confirmation", async () => {
  for (const approved of [false, true]) {
    const calls: unknown[] = [];
    const menu = webMenu({
      setOptionsAt: (value: unknown) => calls.push(["close", value]),
      ask: async (value: unknown) => {
        calls.push(["ask", value]);
        return approved;
      },
      setStatus: (status: string) => calls.push(["status", status]),
    });
    await menu.props.children[0].props.children[0].props.onClick();
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ["close", null]);
    assert.equal((calls[1] as any)[0], "ask");
    assert.equal(calls.length, approved ? 3 : 2);
    if (approved) assert.deepEqual(calls[2], ["status", "cancelled"]);
  }
});

function mobileActions(context: object) {
  const sheet = find(
    mobile,
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(mobile) === "ActionSheet",
  )[0] as ts.JsxSelfClosingElement;
  const attribute = sheet.attributes.properties.find(
    (attr) =>
      ts.isJsxAttribute(attr) && attr.name.getText(mobile) === "actions",
  ) as ts.JsxAttribute;
  assert.ok(
    attribute.initializer &&
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression,
  );
  return evaluate(attribute.initializer.expression, mobile, {
    item: { id: "fixture", title: "Fixture" },
    starred: false,
    cancelAction: null,
    currentCancelAction: { current: null },
    ...context,
  }) as Array<{ label: string; disabled?: boolean; onPress: () => void }>;
}

test("mobile cancellation lives in the existing menu, never a persistent body Button", () => {
  const buttons = find(
    mobile,
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(mobile) === "Button",
  ) as ts.JsxSelfClosingElement[];
  for (const button of buttons)
    assert.equal(
      button.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(mobile) === "title" &&
          attr.initializer &&
          ts.isStringLiteral(attr.initializer) &&
          attr.initializer.text === "Cancel task",
      ),
      false,
    );
  assert.equal(
    mobileActions({}).some((action) => action.label === "Cancel task"),
    false,
  );
  const actions = mobileActions({
    cancelAction: { id: "fixture", disabled: true },
  });
  assert.equal(
    actions.find((action) => action.label === "Cancel task")?.disabled,
    true,
  );
});

test("mobile cancellation uses the cross-platform confirmation before mutation", () => {
  const declaration = find(
    mobile,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(mobile) === "cancelTask",
  )[0] as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  for (const subtasks of [[], [{}]]) {
    let confirmation: (() => void) | undefined;
    const statuses: string[] = [];
    const cancel = evaluate(declaration.initializer, mobile, {
      Platform: { OS: "ios" },
      subtasks,
      confirmAction: (
        title: string,
        message: string,
        label: string,
        onConfirm: () => void,
      ) => {
        assert.equal(title, "Cancel this task?");
        assert.ok(message.includes("You can reopen it later."));
        assert.equal(label, "Cancel task");
        confirmation = onConfirm;
      },
      setStatus: (status: string) => statuses.push(status),
    });
    cancel();
    assert.deepEqual(statuses, []);
    assert.ok(confirmation);
    confirmation();
    assert.deepEqual(statuses, ["cancelled"]);
  }
});

test("mobile browser opens its owned confirmation without a browser-native prompt", () => {
  const declaration = find(
    mobile,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(mobile) === "cancelTask",
  )[0] as ts.VariableDeclaration;
  const calls: string[] = [];
  const cancel = evaluate(declaration.initializer!, mobile, {
    Platform: { OS: "web" },
    item: { id: "fixture" },
    setCancelConfirmId: (id: string) => calls.push(id),
    confirmAction: () =>
      assert.fail("Browser-native confirmation must not run"),
    setStatus: () => assert.fail("Opening confirmation cannot cancel the task"),
  });
  cancel();
  assert.deepEqual(calls, ["fixture"]);
});

test("owned confirmation uses current task eligibility before cancellation", () => {
  const assignment = find(
    mobile,
    (node) =>
      ts.isBinaryExpression(node) &&
      node.left.getText(mobile) === "confirmCancellation.current",
  )[0] as ts.BinaryExpression;
  for (const context of [
    {
      cancelConfirmId: "fixture",
      canCancel: true,
      busy: false,
      expected: true,
    },
    { cancelConfirmId: "other", canCancel: true, busy: false, expected: false },
    {
      cancelConfirmId: "fixture",
      canCancel: false,
      busy: false,
      expected: false,
    },
    {
      cancelConfirmId: "fixture",
      canCancel: true,
      busy: true,
      expected: false,
    },
  ]) {
    const statuses: string[] = [];
    let closed = false;
    const confirm = evaluate(assignment.right, mobile, {
      ...context,
      item: { id: "fixture" },
      setStatus: (status: string) => statuses.push(status),
      setCancelConfirmId: (value: unknown) => {
        assert.equal(value, null);
        closed = true;
      },
    });
    confirm();
    assert.deepEqual(statuses, context.expected ? ["cancelled"] : []);
    assert.equal(closed, true);
  }
});

test("confirmation helper refuses browser dismissal and keeps native affirmative gating", () => {
  const helper = file("../../mobile/src/lib/confirm.ts");
  const code = ts.transpileModule(helper.getFullText(), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  for (const platform of ["web", "ios", "android"]) {
    for (const approved of [false, true]) {
      let mutations = 0;
      let buttons: Array<{ style: string; onPress?: () => void }> = [];
      const exported: { confirmAction?: (...args: unknown[]) => void } = {};
      runInNewContext(code, {
        exports: exported,
        require: (name: string) => {
          assert.equal(name, "react-native");
          return {
            Platform: { OS: platform },
            Alert: {
              alert: (
                _title: string,
                _message: string,
                actions: typeof buttons,
              ) => {
                buttons = actions;
              },
            },
          };
        },
        confirm: () => approved,
      });
      exported.confirmAction!(
        "Cancel task?",
        "Task can be reopened.",
        "Cancel task",
        () => {
          mutations++;
        },
      );
      if (platform === "web") assert.equal(mutations, approved ? 1 : 0);
      else {
        assert.equal(mutations, 0);
        assert.equal(buttons[0].style, "cancel");
        assert.equal(buttons[1].style, "destructive");
        if (approved) buttons[1].onPress!();
        assert.equal(mutations, approved ? 1 : 0);
      }
    }
  }
});

test("mobile registers cancellation only for writable open tasks", () => {
  const declaration = find(
    mobile,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(mobile) === "canCancel",
  )[0] as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  for (const [item, readOnly, expected] of [
    [{ kind: "task", status: "todo" }, false, true],
    [{ kind: "task", status: "todo" }, true, false],
    [{ kind: "event", status: "todo" }, false, false],
    [{ kind: "task", status: "done" }, false, false],
    [{ kind: "task", status: "cancelled" }, false, false],
  ] as const)
    assert.equal(
      evaluate(declaration.initializer, mobile, { item, readOnly, isClosed }),
      expected,
    );
});

test("mobile menu invokes the latest matching enabled confirmation callback", () => {
  let calls = 0;
  const latest: {
    current: null | { id: string; disabled: boolean; onPress: () => void };
  } = {
    current: {
      id: "fixture",
      disabled: false,
      onPress: () => {
        calls++;
      },
    },
  };
  const action = mobileActions({
    cancelAction: { id: "fixture", disabled: false },
    currentCancelAction: latest,
  }).find((value) => value.label === "Cancel task")!;
  action.onPress();
  assert.equal(calls, 1);
  latest.current = {
    id: "other",
    disabled: false,
    onPress: () => {
      calls++;
    },
  };
  action.onPress();
  latest.current = {
    id: "fixture",
    disabled: true,
    onPress: () => {
      calls++;
    },
  };
  action.onPress();
  latest.current = null;
  action.onPress();
  assert.equal(calls, 1);
});
