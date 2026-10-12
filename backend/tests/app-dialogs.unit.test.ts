import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function compile(path: string) {
  return ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
}
function alerts(platform = "web") {
  const exports: any = {};
  const native: unknown[][] = [];
  runInNewContext(compile("../../mobile/src/lib/alert.ts"), {
    exports,
    require: (name: string) => {
      assert.equal(name, "react-native");
      return {
        Platform: { OS: platform },
        Alert: { alert: (...args: unknown[]) => native.push(args) },
      };
    },
  });
  return { ...exports, native };
}

test("Expo web queues dialogs, settles once, and does not mutate on cancellation", () => {
  const api = alerts();
  let changes = 0;
  let notifications = 0;
  const unsubscribe = api.subscribeAlerts(() => notifications++);
  api.Alert.alert("Delete?", "Cannot undo", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", onPress: () => changes++ },
  ]);
  const first = api.currentAlert();
  api.Alert.alert("Saved");
  assert.equal(changes, 0);
  assert.equal(api.currentAlert().id, first.id);
  api.settleAlert(first.id);
  assert.equal(changes, 0);
  assert.equal(api.currentAlert().title, "Saved");
  api.settleAlert(first.id, first.buttons[1]);
  assert.equal(changes, 0, "Stale clicks cannot settle the next request");
  const second = api.currentAlert();
  assert.equal(second.buttons[0].text, "OK");
  api.settleAlert(second.id, second.buttons[0]);
  assert.equal(api.currentAlert(), null);
  assert.equal(notifications, 4);
  unsubscribe();
  api.Alert.alert("Confirm", undefined, [
    { text: "Confirm", onPress: () => changes++ },
  ]);
  const third = api.currentAlert();
  api.settleAlert(third.id, third.buttons[0]);
  api.settleAlert(third.id, third.buttons[0]);
  assert.equal(changes, 1);
});

test("Expo web dismissal invokes cancellation and account reset discards stale actions", () => {
  const api = alerts();
  let cancelled = 0,
    dismissed = 0,
    applied = 0;
  api.Alert.alert(
    "Question",
    undefined,
    [{ style: "cancel", onPress: () => cancelled++ }],
    { onDismiss: () => dismissed++ },
  );
  api.settleAlert(api.currentAlert().id);
  assert.equal(cancelled, 1);
  assert.equal(dismissed, 1);
  api.Alert.alert("Old account", undefined, [{ onPress: () => applied++ }]);
  const old = api.currentAlert();
  api.clearAlerts();
  api.settleAlert(old.id, old.buttons[0]);
  assert.equal(applied, 0);
  assert.equal(api.currentAlert(), null);
});

test("native alert routing retains the original platform arguments", () => {
  for (const platform of ["ios", "android"]) {
    const api = alerts(platform);
    const buttons = [{ text: "Cancel", style: "cancel" }];
    const options = { cancelable: false };
    api.Alert.alert("Question", "Detail", buttons, options);
    assert.deepEqual(api.native, [["Question", "Detail", buttons, options]]);
    assert.equal(api.currentAlert(), null);
  }
});

test("desktop prompts queue, trap focus, cancel safely and restore the opener", async () => {
  const require = createRequire(import.meta.url);
  const mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
  const { JSDOM } = mobileRequire("jsdom");
  const React = require("react");
  const dom = new JSDOM(
    '<body><button id="opener">Open</button><div class="app"><button id="behind">Behind</button></div><div id="root"></div></body>',
    { url: "http://127.0.0.1" },
  );
  const globals = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = globals.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const name of globals)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
  const { createRoot } = require("react-dom/client");
  const exports: any = {};
  runInNewContext(compile("../../desktop/src/components/Confirm.tsx"), {
    exports,
    document: dom.window.document,
    require: (name: string) =>
      name === "lucide-react" ? { AlertTriangle: () => null } : require(name),
  });
  let api: any;
  function Consumer() {
    api = exports.useConfirm();
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(async () =>
      root.render(
        React.createElement(
          exports.ConfirmProvider,
          null,
          React.createElement(Consumer),
        ),
      ),
    );
    const opener = dom.window.document.getElementById("opener");
    opener.focus();
    let first: Promise<string | null>, second: Promise<string | null>;
    await React.act(async () => {
      first = api.prompt({
        title: "Password",
        label: "Password",
        type: "password",
        required: true,
      });
      second = api.prompt({ title: "Name", label: "Name", value: "Draft" });
    });
    assert.equal(
      dom.window.document.querySelector("h2").textContent,
      "Password",
    );
    assert.equal(dom.window.document.activeElement.type, "password");
    assert.equal(dom.window.document.querySelector(".app").inert, true);
    const buttons = dom.window.document.querySelectorAll(
      ".confirm-actions button",
    );
    buttons[1].focus();
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(dom.window.document.activeElement.type, "password");
    await React.act(async () =>
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      ),
    );
    assert.equal(await first!, null);
    assert.equal(dom.window.document.querySelector("h2").textContent, "Name");
    await React.act(async () =>
      dom.window.document
        .querySelector("form")
        .dispatchEvent(
          new dom.window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    assert.equal(await second!, "Draft");
    assert.equal(
      dom.window.document.querySelector('[role="alertdialog"]'),
      null,
    );
    assert.notEqual(dom.window.document.querySelector(".app").inert, true);
    assert.equal(dom.window.document.activeElement, opener);
    let waiting: Promise<string | null>;
    await React.act(async () => {
      waiting = api.prompt({ title: "Pending", label: "Name" });
    });
    await React.act(async () => root.unmount());
    assert.equal(await waiting!, null);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  }
});

test("narrow peek retries loading, contains keyboard focus, and becomes a wide companion pane", async () => {
  const require = createRequire(import.meta.url);
  const { JSDOM } = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  )("jsdom");
  const React = require("react");
  const dom = new JSDOM(
    '<body><div class="shell"><button id="opener">Open</button><button class="command-trigger">Search</button></div><nav class="sidebar"></nav><div id="root"></div></body>',
  );
  const names = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
  const { createRoot } = require("react-dom/client");
  let onResize = () => {};
  const query = {
    matches: false,
    addEventListener: (_: string, callback: () => void) => {
      onResize = callback;
    },
    removeEventListener: () => {},
  };
  dom.window.matchMedia = () => query;
  let loads = 0,
    closed = 0;
  const exports: any = {};
  runInNewContext(compile("../../desktop/src/features/peek/SidePeek.tsx"), {
    exports,
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
    require: (name: string) => {
      if (name.startsWith("react")) return require(name);
      if (name === "../../lib/dialogLayers") {
        const layerExports = {};
        runInNewContext(compile("../../desktop/src/lib/dialogLayers.ts"), {
          exports: layerExports,
          document: dom.window.document,
          window: dom.window,
        });
        return layerExports;
      }
      if (name === "lucide-react")
        return new Proxy({}, { get: () => () => null });
      if (name === "../../lib/api")
        return {
          client: {
            getItem: async () => {
              if (++loads === 1) throw new Error("Unavailable");
              return { title: "Task", status: "todo", notes: "Notes" };
            },
          },
        };
      if (name === "../../lib/errors")
        return { errorText: (error: Error) => error.message };
      if (name === "../../components/ItemFacts")
        return { ItemFacts: () => null };
      return {};
    },
  });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    const opener = dom.window.document.getElementById("opener");
    opener.focus();
    await React.act(async () =>
      root.render(
        React.createElement(exports.SidePeek, {
          target: { kind: "task", id: "qa" },
          pinned: false,
          onPin: () => {},
          onClose: () => closed++,
          report: () => {},
        }),
      ),
    );
    assert.equal(
      dom.window.document.querySelector("aside").getAttribute("aria-modal"),
      "true",
    );
    assert.equal(dom.window.document.querySelector(".shell").inert, true);
    const retry = Array.from(
      dom.window.document.querySelectorAll("button"),
    ).find((button: any) => button.textContent === "Try again") as any;
    assert.ok(retry);
    await React.act(async () => retry.click());
    assert.equal(loads, 2);
    assert.equal(dom.window.document.querySelector("h2").textContent, "Task");
    const close = dom.window.document.querySelector(
      ".peek-actions button:last-child",
    );
    close.focus();
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
    );
    assert.equal(
      dom.window.document.activeElement,
      dom.window.document.querySelector(".peek-actions button"),
    );
    dom.window.document.querySelector(".peek-backdrop").click();
    assert.equal(closed, 1);
    const command = () => {
      const layer = dom.window.document.createElement("div");
      layer.className = "command-backdrop";
      layer.setAttribute("aria-modal", "true");
      const input = dom.window.document.createElement("input");
      layer.append(input);
      dom.window.document.body.append(layer);
      input.focus();
      return { layer, input };
    };
    const narrowCommand = command();
    assert.equal(dom.window.document.activeElement, narrowCommand.input);
    const tab = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    dom.window.document.dispatchEvent(tab);
    assert.equal(
      tab.defaultPrevented,
      false,
      "The higher dialog owns keyboard navigation",
    );
    await React.act(async () => narrowCommand.layer.remove());
    assert.equal(dom.window.document.activeElement, close);
    await React.act(async () => {
      query.matches = true;
      onResize();
    });
    assert.equal(
      dom.window.document.querySelector("aside").getAttribute("role"),
      "complementary",
    );
    assert.equal(dom.window.document.querySelector(".peek-backdrop"), null);
    assert.notEqual(dom.window.document.querySelector(".shell").inert, true);
    const wideCommand = command();
    await React.act(async () => {
      query.matches = false;
      onResize();
    });
    assert.equal(
      dom.window.document.activeElement,
      wideCommand.input,
      "Resizing must preserve the higher dialog’s input",
    );
    assert.equal(dom.window.document.querySelector(".shell").inert, true);
    await React.act(async () => wideCommand.layer.remove());
    assert.equal(dom.window.document.activeElement, close);
    await React.act(async () => root.unmount());
    assert.equal(dom.window.document.activeElement, opener);
    const secondRoot = createRoot(dom.window.document.getElementById("root"));
    const ephemeral = dom.window.document.createElement("input");
    dom.window.document.body.append(ephemeral);
    ephemeral.focus();
    await React.act(async () =>
      secondRoot.render(
        React.createElement(exports.SidePeek, {
          target: { kind: "task", id: "qa" },
          pinned: false,
          onPin: () => {},
          onClose: () => closed++,
          report: () => {},
        }),
      ),
    );
    ephemeral.remove();
    await React.act(async () => secondRoot.unmount());
    assert.equal(
      dom.window.document.activeElement,
      dom.window.document.querySelector(".command-trigger"),
      "A removed palette opener returns focus to the stable search trigger",
    );
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  }
});

test("task drawer leaves Escape and Tab to a higher command dialog", () => {
  const { JSDOM } = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  )("jsdom");
  const dom = new JSDOM(
    '<body><aside aria-modal="true"><button>Close task</button><button>Last</button></aside></body>',
  );
  const source = ts.createSourceFile(
    "TaskDetail.tsx",
    readFileSync(
      new URL(
        "../../desktop/src/features/task/TaskDetail.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0]
        ?.getText(source)
        .includes("if (suspended || scheduling) return")
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(effect);
  const exports: any = {};
  runInNewContext(compile("../../desktop/src/lib/dialogLayers.ts"), {
    exports,
    document: dom.window.document,
    window: dom.window,
  });
  let closed = 0;
  const install = runInNewContext(
    ts.transpileModule(`(${effect.getText(source)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      document: dom.window.document,
      suspended: false,
      scheduling: false,
      renaming: false,
      panel: { current: dom.window.document.querySelector("aside") },
      hasHigherDialog: exports.hasHigherDialog,
      onClose: () => closed++,
    },
  );
  const cleanup = install();
  try {
    const layer = dom.window.document.createElement("div");
    layer.className = "command-backdrop";
    layer.setAttribute("aria-modal", "true");
    const input = dom.window.document.createElement("input");
    layer.append(input);
    dom.window.document.body.append(layer);
    input.focus();
    const escape = () => {
      const event = new dom.window.KeyboardEvent("keydown", {
        key: "Escape",
        cancelable: true,
      });
      dom.window.document.dispatchEvent(event);
      return event;
    };
    assert.equal(escape().defaultPrevented, false);
    assert.equal(closed, 0, "Escape must not close the task behind Search");
    const tab = new dom.window.KeyboardEvent("keydown", {
      key: "Tab",
      cancelable: true,
    });
    dom.window.document.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, false);
    assert.equal(dom.window.document.activeElement, input);
    layer.remove();
    assert.equal(escape().defaultPrevented, true);
    assert.equal(closed, 1);
    const handled = new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    handled.preventDefault();
    dom.window.document.dispatchEvent(handled);
    assert.equal(
      closed,
      1,
      "Previously handled keys must not close another layer",
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("passkey naming cancellation does not register or announce a saved credential", async () => {
  const source = ts.createSourceFile(
    "PasskeysSettings.tsx",
    readFileSync(
      new URL(
        "../../desktop/src/features/settings/PasskeysSettings.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "add")
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer);
  const code = ts.transpileModule(`(${initializer.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const name of [null, "", "Laptop"]) {
    const registrations: unknown[][] = [];
    const outcomes: unknown[] = [];
    let operation: Promise<void> | undefined;
    let loads = 0,
      ceremonies = 0;
    const response = { id: "synthetic-credential" };
    const add = runInNewContext(code, {
      action: {
        run: (fn: () => Promise<unknown>) => {
          operation = fn().then((value) => {
            outcomes.push(value);
          });
        },
      },
      client: {
        passkeyRegisterOptions: async () => ({}),
        registerPasskey: async (...args: unknown[]) => {
          registrations.push(args);
        },
      },
      startRegistration: async () => {
        ceremonies++;
        return response;
      },
      prompt: async () => name,
      load: async () => {
        loads++;
      },
    });
    add();
    await operation;
    assert.equal(ceremonies, 1);
    assert.equal(registrations.length, name === null ? 0 : 1);
    assert.equal(loads, name === null ? 0 : 1);
    assert.deepEqual(outcomes, [name === null ? undefined : "Passkey added."]);
    if (name !== null) assert.deepEqual(registrations, [[response, name]]);
  }
});
