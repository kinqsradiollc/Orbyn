import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

const grant = "11111111-1111-4111-8111-111111111111";
const provider = {
  id: "22222222-2222-4222-8222-222222222222",
  revision: "1",
  name: "Workspace",
  model: "model",
};
const view: core.PluginAiPermissionView = {
  grant_id: grant,
  enabled: false,
  active: false,
  version: 0,
  provider: null,
  available_provider: provider,
  max_output_tokens: 512,
  daily_call_limit: 10,
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(native: boolean, initial = view) {
  const states: any[] = [],
    effects: any[] = [],
    calls: any[] = [];
  let at = 0,
    effectAt = 0,
    current = initial,
    failure = false;
  const hooks = {
    ...React,
    useId: () => "permission",
    useState: (initial: any) => {
      const index = at++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: any) => {
          states[index] = value;
        },
      ];
    },
    useEffect: (run: () => any, deps: any[]) => {
      const index = effectAt++,
        previous = effects[index];
      if (
        !previous ||
        deps.some((value, index) => value !== previous.deps[index])
      ) {
        previous?.cleanup?.();
        effects[index] = { deps, cleanup: run() };
      }
    },
  };
  const client = {
    pluginAiPermission: async () => {
      calls.push("get");
      return current;
    },
    setPluginAiPermission: async (_: string, input: any) => {
      calls.push(input);
      if (failure) throw new Error("private upstream");
      current = {
        ...current,
        enabled: input.enabled,
        active: input.enabled,
        version: current.version + 1,
      };
      return current;
    },
  };
  const modules: Record<string, any> = {
    react: hooks,
    "@orbyn/core": core,
    "../../lib/api": { client },
    "../lib/api": { client },
    "react-native": { Text: "text", View: "view" },
    "../styles": { shared: {} },
    "../components/Field": { Field: "field", NumberInput: "number" },
    "../components/Button": { Button: "button" },
    "../components/SmallAction": { SmallAction: "button" },
  };
  const path = native
    ? "../../mobile/src/screens/PluginAiPermission.tsx"
    : "../../desktop/src/features/settings/PluginAiPermission.tsx";
  const source = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const exports: any = {};
  runInNewContext(source, {
    exports,
    require: (id: string) => {
      if (!(id in modules)) throw new Error(id);
      return modules[id];
    },
    AbortController,
    React: hooks,
  });
  function render() {
    at = 0;
    effectAt = 0;
    return exports.PluginAiPermission({ grantId: grant });
  }
  function nodes(tree: any): any[] {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  }
  function button(label: string) {
    const found = nodes(render()).find(
      (node) =>
        node.props?.label === label ||
        node.props?.title === label ||
        node.props?.children === label,
    );
    assert.ok(found, label);
    return found.props;
  }
  async function click(label: string) {
    const props = button(label);
    assert.ok(!props.disabled, label);
    await (props.onPress ?? props.onClick)();
    await tick();
  }
  async function open() {
    await click("Workspace AI");
    render();
    await tick();
    render();
  }
  function field(name: string, value: string) {
    const node = nodes(render()).find((node) =>
      native
        ? node.props?.accessibilityLabel === name
        : node.type === "input" &&
          node.props.id ===
            `permission-${name === "Calls per day" ? "calls" : "output"}`,
    );
    assert.ok(node);
    if (native) node.props.onChangeText(value);
    else node.props.onChange({ target: { value } });
  }
  return {
    calls,
    open,
    click,
    button,
    field,
    render,
    fail: () => {
      failure = true;
    },
    dispose: () => effects.forEach((effect) => effect?.cleanup?.()),
  };
}
for (const native of [false, true]) {
  const platform = native ? "mobile" : "web/desktop";
  test(`${platform}: plugin AI is off until explicit reviewed consent`, async () => {
    const f = fixture(native);
    assert.deepEqual(f.calls, []);
    await f.open();
    assert.deepEqual(f.calls, ["get"]);
    await f.click("Allow workspace AI");
    assert.deepEqual(f.calls[1], {
      enabled: true,
      expected_version: 0,
      provider: {
        id: provider.id,
        revision: provider.revision,
        model: provider.model,
      },
      max_output_tokens: 512,
      daily_call_limit: 10,
    });
    await f.click("Turn off");
    assert.deepEqual(f.calls[2], { enabled: false, expected_version: 1 });
    f.dispose();
  });
  test(`${platform}: invalid output limits never update permission`, async () => {
    const f = fixture(native);
    await f.open();
    f.field("Output tokens per call", "2049");
    await f.click("Allow workspace AI");
    assert.deepEqual(f.calls, ["get"]);
    f.dispose();
  });
  test(`${platform}: absent providers cannot be enabled`, async () => {
    const f = fixture(native, { ...view, available_provider: null });
    await f.open();
    assert.equal(f.button("Allow workspace AI").disabled, true);
    f.dispose();
  });
  test(`${platform}: failed saves expose recovery without private errors`, async () => {
    const f = fixture(native);
    await f.open();
    f.fail();
    await f.click("Allow workspace AI");
    const text = JSON.stringify(f.render());
    assert.ok(text.includes("Refresh before trying again"));
    assert.ok(!text.includes("private upstream"));
    f.dispose();
  });
}
