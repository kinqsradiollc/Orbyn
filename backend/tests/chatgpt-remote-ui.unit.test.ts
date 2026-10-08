import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";
import { searchSettings, settingById } from "@orbyn/core";

function mount(app: "desktop" | "mobile") {
  const stores: any[] = [];
  const effects: (() => () => void)[] = [];
  let token = "session-a";
  const ref = { current: null };
  const exports: { useChatgptRemote?: (userId: string) => any } = {};
  const compiled = ts.transpileModule(
    readFileSync(
      new URL(`../../${app}/src/hooks/useChatgptRemote.ts`, import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  class Store {
    closed = false;
    reads = 0;
    saves: unknown[] = [];
    selections: unknown[] = [];
    listener?: () => void;
    constructor(public options: any) {
      stores.push(this);
    }
    snapshot() {
      return {
        status: "ready",
        devices: [{ executor_id: "owned-device" }],
        catalog: { binding: { user_id: this.options.userId } },
      };
    }
    subscribe(fn: () => void) {
      this.listener = fn;
      return () => {
        this.listener = undefined;
      };
    }
    async refresh() {
      this.reads++;
      this.listener?.();
    }
    async save(value: unknown) {
      this.saves.push(value);
    }
    async select(value: unknown) {
      this.selections.push(value);
    }
    close() {
      this.closed = true;
    }
  }
  runInNewContext(compiled, {
    exports,
    require(id: string) {
      if (id === "react")
        return {
          useRef: () => ref,
          useState: () => [0, () => {}],
          useEffect: (fn: () => () => void) => effects.push(fn),
        };
      if (id === "@orbyn/api-client") return { ChatgptRemoteStore: Store };
      if (id === "../lib/api") return { client: {} };
      if (id === "../lib/session")
        return {
          session: {
            get: () => token,
            get token() {
              return token;
            },
          },
        };
      throw new Error(`Unexpected module ${id}`);
    },
  });
  return {
    render: exports.useChatgptRemote!,
    effects,
    stores,
    setToken: (value: string) => {
      token = value;
    },
  };
}
for (const app of ["desktop", "mobile"] as const) {
  test(`${app} hook hides old ownership before effects and rejects retained callbacks after account switch`, () => {
    const f = mount(app);
    assert.equal(f.render("user-a").state.status, "idle");
    const cleanup = f.effects[0]();
    const original = f.render("user-a");
    assert.equal(original.state.catalog.binding.user_id, "user-a");
    original.save("model-a");
    assert.equal(f.stores[0].saves.length, 1);
    // Even with the same token, a new owner prop cannot reveal the old list.
    assert.equal(f.render("user-b").state.devices.length, 0);
    f.setToken("session-b");
    assert.equal(f.render("user-b").state.devices.length, 0);
    original.save("model-b");
    original.select({});
    original.refresh();
    assert.equal(f.stores[0].saves.length, 1);
    assert.equal(f.stores[0].selections.length, 0);
    assert.equal(f.stores[0].reads, 1);
    cleanup();
    assert.equal(f.stores[0].closed, true);
    assert.equal(f.stores[0].listener, undefined);
  });
  test(`${app} hook recreates a working controller on StrictMode setup-cleanup-setup`, () => {
    const f = mount(app);
    f.render("user-a");
    f.effects[0]()();
    const cleanup = f.effects[0]();
    const current = f.render("user-a");
    current.refresh();
    assert.equal(f.stores.length, 2);
    assert.equal(f.stores[0].closed, true);
    assert.equal(f.stores[1].closed, false);
    assert.equal(f.stores[1].reads, 2);
    cleanup();
  });
}

test("ChatGPT models are discoverable in both settings search indexes", () => {
  const entry = settingById("chatgpt-models");
  assert.ok(entry);
  assert.deepEqual(entry.phone, { section: "AI connections & models" });
  for (const platform of ["web", "phone"] as const)
    assert.ok(
      searchSettings("ChatGPT", platform).some((e) => e.id === entry.id),
    );
});

function view(
  app: "desktop" | "mobile",
  state: any,
  connectOutcome: "success" | "cancel" | "failure" = "success",
  nativeOptions: {
    account?: object;
    disconnect?: () => Promise<void>;
    prepare?: () => Promise<void>;
    accounts?: object;
    choose?: () => Promise<void>;
  } = {},
) {
  let slot = 0;
  const values: any[] = [];
  const saved: (string | null)[] = [];
  const selected: unknown[] = [];
  const localCalls: string[] = [];
  const connectActions: unknown[] = [];
  const cleanupTargets: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  let sessionToken = "fixture-session";
  const source =
    app === "desktop"
      ? "desktop/src/features/settings/ChatgptRemoteModels.tsx"
      : "mobile/src/screens/settings/ChatgptModelsSection.tsx";
  const compiled = ts.transpileModule(
    readFileSync(new URL(`../../${source}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const exports: Record<string, (props: any) => any> = {};
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  runInNewContext(compiled, {
    exports,
    AbortController,
    require(id: string) {
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "react")
        return {
          useId: () => "fixture",
          useState: (initial: any) => {
            const index = slot++;
            if (!(index in values))
              values[index] =
                typeof initial === "function" ? initial() : initial;
            return [
              values[index],
              (next: any) => {
                values[index] =
                  typeof next === "function" ? next(values[index]) : next;
              },
            ];
          },
          useRef: (initial: any) => {
            const index = slot++;
            if (!(index in values)) values[index] = { current: initial };
            return values[index];
          },
          useEffect: (fn: () => void | (() => void)) => effects.push(fn),
        };
      if (id === "@orbyn/core") return core;
      if (id.endsWith("/lib/api"))
        return {
          client: {
            startChatgptConnectRequest: () => {
              throw new Error("Unexpected authorization");
            },
          },
        };
      if (id.endsWith("/lib/session"))
        return {
          session: {
            get: () => sessionToken,
            get token() {
              return sessionToken;
            },
          },
        };
      if (id.endsWith("/lib/errors"))
        return { errorText: () => "Fixture error" };
      if (id.endsWith("useChatgptRemote"))
        return {
          useChatgptRemote: () => ({
            state,
            refresh: () => {},
            save: (model: string | null) => saved.push(model),
            select: (selection: unknown) => selected.push(selection),
          }),
        };
      if (id.endsWith("/lib/chatgpt-local-sign-in"))
        return {
          prepareNativeChatgptAccounts: async (
            _: string,
            options: { signal: AbortSignal },
          ) => {
            localCalls.push("prepare");
            assert.ok(options.signal instanceof AbortSignal);
            await nativeOptions.prepare?.();
          },
          signInNativeChatgpt: async (
            _: string,
            options: { signal: AbortSignal; action?: unknown },
          ) => {
            connectActions.push(options.action);
            localCalls.push("sign-in");
            if (connectOutcome !== "success")
              throw new Error(
                connectOutcome === "cancel" ? "Cancelled" : "Unavailable",
              );
            return { sharingGranted: true };
          },
          readNativeChatgptAccounts: async () => nativeOptions.accounts ?? null,
          selectNativeChatgptAccount: async (
            _: string,
            id: string,
            revision: string,
            options: { signal: AbortSignal },
          ) => {
            localCalls.push(`choose:${id}:${revision}`);
            assert.ok(options.signal instanceof AbortSignal);
            await nativeOptions.choose?.();
          },
          readNativeChatgptAccountState: async () =>
            nativeOptions.account ?? { status: "missing" },
          disconnectNativeChatgpt: async (
            _: string,
            options: { target?: unknown },
          ) => {
            cleanupTargets.push(options.target);
            localCalls.push("disconnect");
            await nativeOptions.disconnect?.();
          },
          cancelNativeChatgptSignIn: () => {},
        };
      if (id.endsWith("/lib/chatgpt-foreground"))
        return {
          chatgptForeground: {
            snapshot: () => ({
              userId: "person",
              status: "idle",
              selection: null,
            }),
            subscribe: () => () => {},
            suspend: () => {
              localCalls.push("suspend");
            },
            restart: () => {
              localCalls.push("restart");
            },
          },
        };
      if (id === "react-native")
        return {
          Platform: { OS: "ios" },
          ...Object.fromEntries(
            ["ScrollView", "Text", "TextInput", "View"].map((name) => [
              name,
              name,
            ]),
          ),
        };
      if (id.endsWith("/motion")) return { Pressable: "Pressable" };
      if (id.endsWith("/Select")) return { Select: "Select" };
      if (id.endsWith("/SmallAction")) return { SmallAction: "SmallAction" };
      if (id.endsWith("/MoreMenu")) return { MoreMenu: "MoreMenu" };
      if (id.endsWith("/SettingsSection"))
        return { SettingsSection: "SettingsSection" };
      if (id === "./AiProviderChoice")
        return { AiProviderChoiceControls: "AiProviderChoiceControls" };
      if (id === "./ChatgptUsage") return { ChatgptUsage: "ChatgptUsage" };
      if (id === "./AgendaPrivateSettings")
        return { AgendaPrivateSettings: "AgendaPrivateSettings" };
      if (id.endsWith("/theme")) return { colors: {} };
      if (id.endsWith("/styles")) return { shared: {} };
      throw new Error(`Unexpected module ${id}`);
    },
  });
  const render = (userId = "person") => {
    slot = 0;
    return exports[
      app === "desktop" ? "ChatgptRemoteModels" : "ChatgptModelsSection"
    ]({ userId });
  };
  return {
    render,
    saved,
    selected,
    localCalls,
    connectActions,
    cleanupTargets,
    setToken: (value: string) => {
      sessionToken = value;
    },
    flushEffects: async () => {
      const cleanup = effects.splice(0).map((fn) => fn());
      await new Promise((resolve) => setImmediate(resolve));
      return () => cleanup.forEach((fn) => fn?.());
    },
  };
}
function elements(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object") return [];
  return [node, ...elements(node.props?.children)];
}
function viewState() {
  const devices = [
    {
      executor_id: "device",
      connection_id: "account",
      host_id: "fixture-host",
    },
  ];
  const models = Array.from({ length: 120 }, (_, i) => ({
    slug: `model-${i}`,
    display_name: `A long model label ${i}`,
  }));
  return {
    status: "ready",
    saving: false,
    error: null,
    devices,
    selection: { executor_id: "device", connection_id: "account" },
    catalog: {
      models,
      status: "ready",
      preference: { model: "model-99" },
      capabilities: ["plan_inference_v1"],
      published_at: new Date().toISOString(),
    },
  };
}

for (const app of ["desktop", "mobile"] as const) {
  test(`${app} offers only a ready inference catalog with an available default as a provider`, () => {
    for (const condition of [
      "ready",
      "loading",
      "saving",
      "offline",
      "stale",
      "unavailable",
      "missing-default",
      "removed-default",
      "no-inference",
      "no-catalog",
    ] as const) {
      const state: any = viewState();
      if (condition === "loading") state.status = "loading";
      if (condition === "saving") state.saving = true;
      if (["offline", "stale", "unavailable"].includes(condition))
        state.catalog.status = condition;
      if (condition === "missing-default")
        state.catalog.preference.model = null;
      if (condition === "removed-default")
        state.catalog.preference.model = "removed-model";
      if (condition === "no-inference") state.catalog.capabilities = [];
      if (condition === "no-catalog") state.catalog = null;
      const tree = elements(view(app, state).render());
      const provider = tree.find((n) => n.type === "AiProviderChoiceControls");
      assert.ok(provider);
      if (condition === "ready")
        assert.deepEqual(
          JSON.parse(JSON.stringify(provider.props.selection)),
          state.selection,
        );
      else assert.equal(provider.props.selection, null, condition);
    }
  });
}

test("web model controls route explicit devices/defaults and preserve a filtered-out default", () => {
  const f = view("desktop", viewState());
  let tree = elements(f.render());
  const device = tree.find(
    (n) => n.type === "Select" && n.props.id.endsWith("-device"),
  );
  device.props.onChange({ target: { value: "unknown" } });
  assert.equal(f.selected.length, 0);
  device.props.onChange({ target: { value: "device" } });
  assert.equal((f.selected[0] as any).connection_id, "account");
  tree
    .find((n) => n.type === "input")
    .props.onChange({ target: { value: "model-119" } });
  tree = elements(f.render());
  const model = tree.find(
    (n) => n.type === "Select" && n.props.id.endsWith("-model"),
  );
  assert.equal(model.props.value, "model-99");
  assert.ok(
    tree.some((n) => n.type === "option" && n.props.value === "model-99"),
  );
  assert.ok(
    tree.some((n) => n.type === "option" && n.props.value === "model-119"),
  );
  model.props.onChange({ target: { value: "model-119" } });
  assert.equal(f.saved[0], "model-119");
});

test("native model list is bounded while search reaches models beyond the first page", () => {
  const f = view("mobile", viewState());
  let tree = elements(f.render());
  const radios = () =>
    tree.filter(
      (n) => n.type === "Pressable" && n.props.accessibilityRole === "radio",
    );
  assert.equal(radios().length, 51, "one device and at most 50 model rows");
  radios()[0].props.onPress();
  assert.equal((f.selected[0] as any).executor_id, "device");
  tree.find((n) => n.type === "TextInput").props.onChangeText("model-119");
  tree = elements(f.render());
  assert.equal(radios().length, 2);
  radios()[1].props.onPress();
  assert.equal(f.saved[0], "model-119");
  tree
    .find(
      (n) =>
        n.type === "SmallAction" && n.props.label === "Clear default model",
    )
    .props.onPress();
  assert.equal(f.saved[1], null);
});

for (const app of ["desktop", "mobile"] as const) {
  test(`${app} disables model selection when the device is offline or a save is running`, () => {
    for (const condition of ["offline", "saving"]) {
      const state = viewState();
      if (condition === "offline") state.catalog.status = "offline";
      else state.saving = true;
      const tree = elements(view(app, state).render());
      const modelControls =
        app === "desktop"
          ? tree.filter(
              (n) => n.type === "Select" && n.props.id.endsWith("-model"),
            )
          : tree
              .filter(
                (n) =>
                  n.type === "Pressable" &&
                  n.props.accessibilityRole === "radio",
              )
              .slice(1);
      assert.ok(modelControls.length);
      assert.ok(modelControls.every((n) => n.props.disabled));
    }
  });
}

test("native Connect invokes local sign-in and resumes the app-owned executor without desktop handoff", async () => {
  const f = view("mobile", viewState());
  const action = elements(f.render()).find(
    (n) => n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
  );
  assert.ok(action);
  assert.equal(action.props.disabled, false);
  action.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, [
    "suspend",
    "prepare",
    "sign-in",
    "prepare",
    "restart",
  ]);
});

test("failed or cancelled native reconnect restores the previous executor without repeating sign-in", async () => {
  for (const outcome of ["cancel", "failure"] as const) {
    const f = view("mobile", viewState(), outcome);
    const action = elements(f.render()).find(
      (n) => n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
    );
    action.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.localCalls, [
      "suspend",
      "prepare",
      "sign-in",
      "restart",
    ]);
    assert.equal(
      elements(f.render()).find(
        (n) =>
          n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
      ).props.disabled,
      false,
    );
  }
});

test("native Settings keeps Disconnect available when saved plan permission is off and executor idle", async () => {
  const f = view("mobile", viewState(), "success", {
    account: { status: "saved", planUseAllowed: false },
  });
  f.render();
  await f.flushEffects();
  const tree = elements(f.render());
  const action = tree.find(
    (n) =>
      n.type === "SmallAction" && n.props.label === "Disconnect this device",
  );
  assert.ok(action);
  assert.equal(action.props.disabled, false);
  assert.ok(
    tree.some((n) =>
      String(n.props.children).includes("ChatGPT plan use is off"),
    ),
  );
  action.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, ["suspend", "disconnect", "restart"]);
});
test("native Settings permits removal of a saved corrupt record", async () => {
  const f = view("mobile", viewState(), "success", {
    account: { status: "unreadable" },
  });
  f.render();
  await f.flushEffects();
  assert.ok(
    elements(f.render()).some(
      (n) =>
        n.type === "SmallAction" && n.props.label === "Disconnect this device",
    ),
  );
});
test("native Settings rejects retained disconnect callbacks after owner or session changes", async () => {
  for (const change of ["owner", "token"]) {
    const f = view("mobile", viewState(), "success", {
      account: { status: "saved", planUseAllowed: true },
    });
    f.render();
    await f.flushEffects();
    const action = elements(f.render()).find(
      (n) =>
        n.type === "SmallAction" && n.props.label === "Disconnect this device",
    );
    if (change === "token") f.setToken("new-session");
    const next = elements(
      f.render(change === "owner" ? "new-person" : "person"),
    );
    assert.equal(
      next.some(
        (n) =>
          n.type === "SmallAction" &&
          n.props.label === "Disconnect this device",
      ),
      false,
    );
    action.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.localCalls, []);
  }
});
test("native disconnect serializes clicks and cannot restart or show an error in a replacement session", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const f = view("mobile", viewState(), "success", {
    account: { status: "saved", planUseAllowed: true },
    disconnect: () => pending,
  });
  f.render();
  await f.flushEffects();
  const action = elements(f.render()).find(
    (n) =>
      n.type === "SmallAction" && n.props.label === "Disconnect this device",
  );
  action.props.onPress();
  action.props.onPress();
  f.setToken("replacement-session");
  f.render();
  reject(new Error("old-owner failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, ["suspend", "disconnect"]);
  assert.equal(
    elements(f.render()).some((n) => n.props.accessibilityRole === "alert"),
    false,
  );
});

test("native Settings shows ended-session recovery with Connect and Disconnect available", async () => {
  const f = view("mobile", viewState(), "success", {
    account: { status: "reconnect" },
  });
  f.render();
  await f.flushEffects();
  const tree = elements(f.render());
  assert.ok(
    tree.some((n) => String(n.props.children).includes("session has ended")),
  );
  for (const label of ["Connect to ChatGPT", "Disconnect this device"]) {
    const action = tree.find(
      (n) => n.type === "SmallAction" && n.props.label === label,
    );
    assert.ok(action);
    assert.equal(action.props.disabled, false);
  }
});
test("native Settings never starts OAuth when protected migration fails", async () => {
  const f = view("mobile", viewState(), "success", {
    prepare: async () => {
      throw new Error("migration failed");
    },
  });
  const action = elements(f.render()).find(
    (n) => n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
  );
  action.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, ["suspend", "prepare", "restart"]);
  assert.ok(
    elements(f.render()).some((n) => n.props.accessibilityRole === "alert"),
  );
});
test("native Settings does not authorize or restart an old owner after migration awaits", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = view("mobile", viewState(), "success", { prepare: () => pending });
  const action = elements(f.render()).find(
    (n) => n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
  );
  action.props.onPress();
  action.props.onPress();
  f.setToken("new-owner-session");
  f.render();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, ["suspend", "prepare"]);
  assert.equal(
    elements(f.render()).some((n) => n.props.accessibilityRole === "alert"),
    false,
  );
});
const pickerAccounts = {
  revision: "picker-revision",
  selected: "account-one",
  accounts: [
    { connection: { id: "account-one" }, status: "connected" },
    { connection: { id: "account-two" }, status: "connected" },
    { connection: { id: "account-three" }, status: "reconnect" },
  ],
};
test("native saved account picker binds explicit choices and reconnects to the displayed revision", async () => {
  const f = view("mobile", viewState(), "success", {
    accounts: pickerAccounts,
  });
  f.render();
  await f.flushEffects();
  const nodes = elements(f.render());
  const scroll = nodes.find(
    (n) => n.type === "ScrollView" && n.props.style?.maxHeight === 200,
  );
  assert.equal(scroll.props.contentContainerStyle.gap, 16);
  assert.equal(scroll.props.contentContainerStyle.paddingVertical, 8);
  const current = nodes.find(
    (n) => n.type === "SmallAction" && n.props.label === "Account 1 · current",
  );
  const choice = nodes.find(
    (n) => n.type === "SmallAction" && n.props.label === "Account 2",
  );
  const unavailable = nodes.find(
    (n) => n.type === "SmallAction" && n.props.label === "Reconnect account 3",
  );
  assert.equal(current.props.disabled, true);
  assert.equal(unavailable.props.disabled, false);
  assert.equal(choice.props.disabled, false);
  choice.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, [
    "suspend",
    "choose:account-two:picker-revision",
    "restart",
  ]);
});
test("native picker fences repeated clicks and old-owner completion during selection", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = view("mobile", viewState(), "success", {
    accounts: pickerAccounts,
    choose: () => pending,
  });
  f.render();
  await f.flushEffects();
  const choice = elements(f.render()).find(
    (n) => n.type === "SmallAction" && n.props.label === "Account 2",
  );
  choice.props.onPress();
  choice.props.onPress();
  assert.ok(
    elements(f.render()).some(
      (n) => n.type === "SmallAction" && n.props.label === "Cancel switch",
    ),
  );
  f.setToken("replacement-session");
  f.render();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, [
    "suspend",
    "choose:account-two:picker-revision",
  ]);
  assert.equal(
    elements(f.render()).some((n) =>
      String(n.props.label).startsWith("Account "),
    ),
    false,
  );
});
test("failed native selection resumes preserved runtime and reports an owned error", async () => {
  const f = view("mobile", viewState(), "success", {
    accounts: pickerAccounts,
    choose: async () => {
      throw new Error("failed");
    },
  });
  f.render();
  await f.flushEffects();
  const choice = elements(f.render()).find(
    (n) => n.type === "SmallAction" && n.props.label === "Account 2",
  );
  choice.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.localCalls, [
    "suspend",
    "choose:account-two:picker-revision",
    "restart",
  ]);
  assert.ok(
    elements(f.render()).some((n) => n.props.accessibilityRole === "alert"),
  );
});
test("native Settings distinguishes Add from a targeted unavailable-account reconnect", async () => {
  for (const action of ["add", "reconnect"] as const) {
    const f = view("mobile", viewState(), "success", {
      accounts: pickerAccounts,
    });
    f.render();
    await f.flushEffects();
    const label =
      action === "add" ? "Add ChatGPT account" : "Reconnect account 3";
    const button = elements(f.render()).find(
      (n) => n.type === "SmallAction" && n.props.label === label,
    );
    assert.equal(button.props.disabled, false);
    button.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      JSON.parse(JSON.stringify(f.connectActions[0])),
      action === "add"
        ? { kind: "add", expectedRevision: "picker-revision" }
        : {
            kind: "reconnect",
            connectionId: "account-three",
            expectedRevision: "picker-revision",
          },
    );
  }
});
test("native account menu binds rare cleanup to its displayed identity and revision", async () => {
  const f = view("mobile", viewState(), "success", {
    accounts: pickerAccounts,
  });
  f.render();
  await f.flushEffects();
  const menu = elements(f.render()).find(
    (n) => n.type === "MoreMenu" && n.props.label === "Account 3 options",
  );
  assert.equal(menu.props.actions[0].label, "Disconnect account");
  assert.equal(menu.props.actions[0].destructive, true);
  menu.props.actions[0].onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(f.cleanupTargets[0])), {
    connectionId: "account-three",
    expectedRevision: "picker-revision",
  });
  assert.deepEqual(f.localCalls, ["suspend", "disconnect", "restart"]);
});

// A browser must not imply local OAuth or enqueue an invisible desktop dependency.
test("web account management does not offer a nonfunctional connect action", () => {
  const screen = view("desktop", viewState());
  const nodes = elements(screen.render());
  assert.ok(
    !nodes.some(
      (node) =>
        node.type === "button" && /Connect/.test(String(node.props.children)),
    ),
  );
  assert.ok(
    nodes.some(
      (node) =>
        node.type === "p" &&
        /Direct web sign-in is unavailable/.test(String(node.props.children)),
    ),
  );
});
