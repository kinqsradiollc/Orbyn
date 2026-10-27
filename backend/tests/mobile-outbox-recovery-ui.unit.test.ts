import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Node = { type: string | ((props: any) => Node); props: any };
function nodes(node: any): Node[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

function fixture(
  name: "SyncSheet" | "SyncBar",
  patch: Record<string, unknown> = {},
) {
  const state = {
    entries: [],
    offline: false,
    sending: false,
    syncedAt: null,
    recovery: null,
    storageError: null,
    ...patch,
  };
  const session = { token: "account-a", userId: "user-a", generation: 1 };
  const calls: string[] = [];
  const updates: unknown[] = [];
  let confirmation: any[] = [];
  let copySucceeds = true;
  let storageFails = false;
  const outbox = {
    outboxState: () => state,
    recoveryCopy: async () => {
      calls.push("read-copy");
      return "private saved payload";
    },
    discardRecovery: async () => {
      calls.push("discard");
    },
    loadOutbox: async () => {
      calls.push("load");
      if (storageFails) throw new Error("Storage unavailable");
    },
    flush: async () => {
      calls.push("flush");
    },
    resolve: async (key: string, choice: string, binding: unknown) => {
      calls.push(`resolve:${key}:${choice}:${JSON.stringify(binding)}`);
      if (storageFails) throw new Error("Storage unavailable");
    },
  };
  const source = readFileSync(
    new URL(
      `../../mobile/src/${name === "SyncSheet" ? "features/settings" : "components"}/${name}.tsx`,
      import.meta.url,
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, (props: any) => Node> = {};
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "react")
        return {
          createElement: (
            type: Node["type"],
            props: any,
            ...children: any[]
          ) => ({ type, props: { ...props, children } }),
          useState: (value: unknown) => [
            value,
            (next: unknown) => updates.push(next),
          ],
          useRef: (current: unknown) => ({ current }),
          useCallback: (fn: unknown) => fn,
          useEffect: () => {},
        };
      if (id === "react-native")
        return {
          Text: "Text",
          View: "View",
          ScrollView: "ScrollView",
          StyleSheet: { create: (x: unknown) => x },
        };
      if (id === "expo-clipboard")
        return {
          setStringAsync: async (text: string) => {
            calls.push(`clipboard:${text}`);
            return copySucceeds;
          },
        };
      if (id.endsWith("/outbox")) return outbox;
      if (id.endsWith("/session")) return { session };
      if (id.endsWith("/confirm"))
        return {
          confirmAction: (...args: any[]) => {
            confirmation = args;
          },
        };
      if (id.endsWith("/errors")) return { errorText: (e: Error) => e.message };
      if (id.endsWith("/device")) return { deviceId: () => "device" };
      if (id.endsWith("/api"))
        return {
          client: {
            listDevices: async () => [],
            presenceSettings: async () => ({}),
          },
        };
      if (id.endsWith("/theme"))
        return {
          colors: {},
          fonts: {},
          radii: {},
          themed: (fn: () => unknown) => fn(),
        };
      if (id.endsWith("/styles")) return { shared: {} };
      if (id === "@orbyn/core")
        return { describeOp: () => "Saved change", fieldsLabel: () => "Title" };
      if (id.endsWith("/Sheet")) return { Sheet: "Sheet", sheetStyles: {} };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  const render = () => {
    const root = exports[name]({
      visible: true,
      outbox: state,
      onClose: () => {},
      onOpen: () => {},
    });
    if (name === "SyncBar") return root;
    const body = nodes(root).find((n) => typeof n.type === "function")!;
    return (body.type as (props: any) => Node)(body.props);
  };
  return {
    render,
    renderEntry: () => {
      const entry = nodes(render()).find(
        (n) => typeof n.type === "function" && n.props?.entry,
      )!;
      return (entry.type as (props: any) => Node)(entry.props);
    },
    state,
    session,
    calls,
    updates,
    confirmation: () => confirmation,
    failCopy: () => {
      copySucceeds = false;
    },
    failStorage: () => {
      storageFails = true;
    },
  };
}
const press = (tree: Node, label: string) => {
  const button = nodes(tree).find((n) => n.props?.label === label);
  assert.ok(button, `Missing ${label}`);
  button.props.onPress();
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("pending discard confirms server uncertainty and passes its rendered session binding", async () => {
  const f = fixture("SyncSheet", {
    entries: [{ key: "pending", state: "pending" }],
  });
  press(f.renderEntry(), "Discard");
  assert.deepEqual(f.calls, []);
  assert.match(f.confirmation()[1], /may already have been sent/);
  f.confirmation()[3]();
  await settle();
  assert.deepEqual(f.calls, [
    'resolve:pending:drop:{"userId":"user-a","generation":1}',
  ]);
});

test("entry actions reject stale session generations and surface rejected storage writes", async () => {
  const stale = fixture("SyncSheet", {
    entries: [{ key: "pending", state: "pending" }],
  });
  press(stale.renderEntry(), "Discard");
  stale.session.generation++;
  stale.confirmation()[3]();
  await settle();
  assert.deepEqual(stale.calls, []);

  const failed = fixture("SyncSheet", {
    entries: [{ key: "failed", state: "failed" }],
  });
  failed.failStorage();
  press(failed.renderEntry(), "Try again");
  await settle();
  assert.ok(failed.updates.includes("Storage unavailable"));
});

test("uncertain retry waits for consent and rejects consent from an older session", async () => {
  const f = fixture("SyncSheet", {
    entries: [{ key: "unknown", state: "failed", uncertain: true }],
  });
  press(f.renderEntry(), "Try again");
  await settle();
  assert.deepEqual(f.calls, [], "canceling leaves the saved command untouched");
  assert.equal(f.confirmation()[2], "Retry anyway");
  assert.match(
    f.confirmation()[1],
    /Check the result first.*create a duplicate/,
  );
  f.session.generation++;
  f.confirmation()[3]();
  await settle();
  assert.deepEqual(f.calls, []);

  const consented = fixture("SyncSheet", {
    entries: [{ key: "unknown", state: "failed", uncertain: true }],
  });
  press(consented.renderEntry(), "Try again");
  consented.confirmation()[3]();
  await settle();
  assert.deepEqual(consented.calls, [
    'resolve:unknown:retry:{"userId":"user-a","generation":1}',
  ]);
});

test("sync details explain that active account changes survive sign-out", () => {
  const tree = fixture("SyncSheet", {
    entries: [{ key: "owned-change", state: "failed" }],
  }).render();
  const text = nodes(tree)
    .flatMap((n) => n.props?.children ?? [])
    .filter((child) => typeof child === "string")
    .join(" ");
  assert.match(text, /stay on this device for this account after sign-out/);
});

test("sync bar exposes held and storage-error states with no active entries", () => {
  assert.equal(fixture("SyncBar").render(), null);
  for (const patch of [
    { recovery: { count: 2, reason: "Account unknown" } },
    { storageError: "Could not read saved changes" },
  ]) {
    const tree = fixture("SyncBar", patch).render();
    assert.match(tree.props.accessibilityLabel, /saved changes|saved change/i);
    assert.doesNotMatch(tree.props.accessibilityLabel, /private saved payload/);
  }
});

test("copy requires consent, hides payload, catches clipboard failure and fences account changes", async () => {
  const f = fixture("SyncSheet", {
    recovery: { count: 2, reason: "Account unknown" },
  });
  const tree = f.render();
  assert.doesNotMatch(JSON.stringify(tree), /private saved payload/);
  press(tree, "Copy saved changes");
  assert.deepEqual(f.calls, []);
  assert.match(f.confirmation()[1], /previously signed-in account/);
  assert.equal(f.confirmation()[4], false);
  f.failCopy();
  f.confirmation()[3]();
  await settle();
  assert.deepEqual(f.calls, ["read-copy", "clipboard:private saved payload"]);
  assert.ok(f.updates.includes("Couldn't copy saved changes. Try again."));

  const switched = fixture("SyncSheet", {
    recovery: { count: 1, reason: "Account unknown" },
  });
  press(switched.render(), "Copy saved changes");
  switched.session.token = "account-b";
  switched.confirmation()[3]();
  await settle();
  assert.deepEqual(switched.calls, []);
});

test("discard requires destructive consent; storage retry loads before sending and catches read failure", async () => {
  const f = fixture("SyncSheet", {
    recovery: { count: 0, reason: "Saved data could not be read" },
  });
  press(f.render(), "Discard saved changes");
  assert.deepEqual(f.calls, []);
  assert.equal(f.confirmation()[4], true);
  assert.match(f.confirmation()[1], /cannot be undone/);
  f.confirmation()[3]();
  await settle();
  assert.deepEqual(f.calls, ["discard"]);

  const retry = fixture("SyncSheet", { storageError: "Storage unavailable" });
  press(retry.render(), "Retry saved changes");
  await settle();
  assert.deepEqual(retry.calls, ["load", "flush"]);
  const failed = fixture("SyncSheet", { storageError: "Storage unavailable" });
  failed.failStorage();
  press(failed.render(), "Retry saved changes");
  await settle();
  assert.deepEqual(failed.calls, ["load"]);
  assert.ok(failed.updates.includes("Storage unavailable"));
});
