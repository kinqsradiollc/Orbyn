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
) {
  let slot = 0;
  const values: any[] = [];
  const saved: (string | null)[] = [];
  const selected: unknown[] = [];
  const localCalls: string[] = [];
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
          useEffect: () => {},
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
          session: { get: () => "fixture-session", token: "fixture-session" },
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
          signInNativeChatgpt: async () => {
            localCalls.push("sign-in");
            if (connectOutcome !== "success")
              throw new Error(
                connectOutcome === "cancel" ? "Cancelled" : "Unavailable",
              );
            return { sharingGranted: true };
          },
          disconnectNativeChatgpt: async () => {},
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
  const render = () => {
    slot = 0;
    return exports[
      app === "desktop" ? "ChatgptRemoteModels" : "ChatgptModelsSection"
    ]({ userId: "person" });
  };
  return { render, saved, selected, localCalls };
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
      published_at: new Date().toISOString(),
    },
  };
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
  assert.deepEqual(f.localCalls, ["suspend", "sign-in", "restart"]);
});

test("failed or cancelled native reconnect restores the previous executor without repeating sign-in", async () => {
  for (const outcome of ["cancel", "failure"] as const) {
    const f = view("mobile", viewState(), outcome);
    const action = elements(f.render()).find(
      (n) => n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
    );
    action.props.onPress();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(f.localCalls, ["suspend", "sign-in", "restart"]);
    assert.equal(
      elements(f.render()).find(
        (n) =>
          n.type === "SmallAction" && n.props.label === "Connect to ChatGPT",
      ).props.disabled,
      false,
    );
  }
});
