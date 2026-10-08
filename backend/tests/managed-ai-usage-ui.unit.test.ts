import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { aiUsageSummary } from "@orbyn/core";
const summary = {
  window_days: 30,
  enabled: false,
  requests: 2,
  usage: {
    input_tokens: 1200,
    output_tokens: 40,
    reasoning_tokens: null,
    cached_input_tokens: 1000,
    cache_write_tokens: null,
  },
};
async function mount(app: "desktop" | "mobile") {
  const path =
    app === "desktop"
      ? "desktop/src/features/settings/ManagedAiUsage.tsx"
      : "mobile/src/screens/settings/ManagedAiUsage.tsx";
  const compiled = ts.transpileModule(
    await readFile(new URL(`../../${path}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const slots: any[] = [],
    effectSlots: any[] = [],
    cleanups: (() => void)[] = [];
  let cursor = 0,
    effects: (() => void)[] = [],
    token = "session-a";
  const calls: {
    signal: AbortSignal;
    resolve: (v: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const exports: any = {};
  const jsx = (type: any, props: any) => ({ type, props });
  runInNewContext(compiled, {
    exports,
    AbortController,
    Date,
    require(id: string) {
      if (id === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (id === "react")
        return {
          useState: (initial: any) => {
            const i = cursor++;
            if (!(i in slots)) slots[i] = initial;
            return [
              slots[i],
              (value: any) => {
                slots[i] =
                  typeof value === "function" ? value(slots[i]) : value;
              },
            ];
          },
          useEffect: (fn: () => () => void, deps: any[]) => {
            const i = cursor++,
              old = effectSlots[i];
            if (!old || deps.some((value, n) => value !== old[n])) {
              effectSlots[i] = deps;
              effects.push(() => {
                cleanups[i]?.();
                cleanups[i] = fn();
              });
            }
          },
        };
      if (id === "@orbyn/core") return { aiUsageSummary };
      if (id.endsWith("/api"))
        return {
          client: {
            managedAiUsage: (signal: AbortSignal) =>
              new Promise((resolve, reject) =>
                calls.push({ signal, resolve, reject }),
              ),
          },
        };
      if (id.endsWith("/session"))
        return {
          session: {
            get: () => token,
            get token() {
              return token;
            },
          },
        };
      if (id.endsWith("/errors"))
        return { errorText: () => "Failed to load usage" };
      if (id === "react-native") return { View: "View", Text: "Text" };
      if (id.endsWith("/SmallAction")) return { SmallAction: "SmallAction" };
      if (id.endsWith("/styles")) return { shared: { small: {}, body: {} } };
      throw new Error(id);
    },
  });
  return {
    calls,
    setToken: (value: string) => {
      token = value;
    },
    render: (userId: string) => {
      cursor = 0;
      effects = [];
      const tree = exports.ManagedAiUsage({ userId });
      for (const effect of effects) effect();
      return tree;
    },
    close: () => {
      for (const cleanup of cleanups) cleanup?.();
    },
  };
}
function nodes(value: any): any[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props?.children)];
}
function content(value: any): string {
  if (value === null || value === undefined || typeof value === "boolean")
    return "";
  if (Array.isArray(value)) return value.map(content).join(" ");
  if (typeof value !== "object") return String(value);
  return [value.props?.label ?? "", content(value.props?.children)].join(" ");
}
function open(tree: any) {
  const button = nodes(tree).find(
    (n) =>
      n.props?.label === "Workspace provider usage" ||
      content(n) === " Workspace provider usage",
  );
  assert.ok(button);
  (button.props.onPress ?? button.props.onClick)();
}
for (const app of ["desktop", "mobile"] as const) {
  test(`${app} usage loads only on demand and preserves observed counters without inventing quota`, async () => {
    const f = await mount(app);
    try {
      const initial = f.render("a");
      assert.equal(f.calls.length, 0);
      open(initial);
      f.render("a");
      assert.equal(f.calls.length, 1);
      f.calls[0].resolve(summary);
      await Promise.resolve();
      const text = content(f.render("a")).replace(/\s+/g, " ");
      assert.match(text, /provider responses/);
      assert.ok(!text.includes("saved-assistant"));
      assert.ok(!text.includes("Excludes other features"));
      assert.match(text, /1200 input/);
      assert.match(text, /40 output/);
      assert.match(text, /1000 cached input/);
      assert.ok(!text.includes("reasoning"));
      assert.match(text, /Usage collection is off in Privacy/);
      assert.match(
        text,
        /Recorded responses only. Not billing or ChatGPT plan limits/,
      );
      f.setToken("session-b");
      const changed = content(f.render("b"));
      assert.ok(!changed.includes("1200 input"));
      assert.equal(f.calls.length, 1);
    } finally {
      f.close();
    }
  });
  test(`${app} reports loading errors and refresh retries without retaining stale counters`, async () => {
    const f = await mount(app);
    try {
      open(f.render("a"));
      assert.match(content(f.render("a")), /Loading usage/);
      f.calls[0].reject(new Error("Offline fixture"));
      await Promise.resolve();
      let tree = f.render("a");
      assert.match(content(tree), /Failed to load usage/);
      const refresh = nodes(tree).find(
        (n) =>
          n.props?.label === "Refresh usage" || content(n) === " Refresh usage",
      );
      assert.ok(refresh);
      (refresh.props.onPress ?? refresh.props.onClick)();
      f.render("a");
      assert.equal(f.calls.length, 2);
      assert.ok(f.calls[0].signal.aborted);
      tree = f.render("a");
      assert.match(content(tree), /Loading usage/);
      assert.ok(!content(tree).includes("Failed to load usage"));
      f.calls[1].resolve(summary);
      await Promise.resolve();
      assert.match(content(f.render("a")), /1200 input/);
    } finally {
      f.close();
    }
  });
  test(`${app} closing usage cancels a pending response`, async () => {
    const f = await mount(app);
    try {
      open(f.render("a"));
      f.render("a");
      open(f.render("a"));
      f.render("a");
      assert.ok(f.calls[0].signal.aborted);
      f.calls[0].resolve(summary);
      await Promise.resolve();
      assert.ok(!content(f.render("a")).includes("1200 input"));
    } finally {
      f.close();
    }
  });
  test(`${app} rejects a delayed usage response after account replacement`, async () => {
    const f = await mount(app);
    try {
      open(f.render("a"));
      f.render("a");
      f.setToken("session-b");
      f.render("b");
      assert.ok(f.calls[0].signal.aborted);
      f.calls[0].resolve(summary);
      await Promise.resolve();
      assert.ok(!content(f.render("b")).includes("1200 input"));
    } finally {
      f.close();
    }
  });
}
