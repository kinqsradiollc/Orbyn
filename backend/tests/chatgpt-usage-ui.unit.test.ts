import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { formatChatgptTokens } from "@orbyn/core";
const summary = {
  since: "2026-09-04T00:00:00.000Z",
  until: "2026-10-04T00:00:00.000Z",
  recording_enabled: true,
  completed_requests: 2,
  measured_requests: 1,
  input_tokens: "9007199254740993",
  output_tokens: "1",
  total_tokens: "9007199254740994",
  recent: [],
};
async function mount(app: "desktop" | "mobile") {
  const path =
    app === "desktop"
      ? "desktop/src/features/settings/ChatgptUsage.tsx"
      : "mobile/src/screens/settings/ChatgptUsage.tsx";
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
  const calls: { signal: AbortSignal; resolve: (v: unknown) => void }[] = [];
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
      if (id === "@orbyn/core") return { formatChatgptTokens };
      if (id.endsWith("/api"))
        return {
          client: {
            chatgptUsage: (signal: AbortSignal) =>
              new Promise((resolve) => calls.push({ signal, resolve })),
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
      const tree = exports.ChatgptUsage({ userId });
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
      n.props?.label === "Usage in Orbyn" || content(n) === " Usage in Orbyn",
  );
  assert.ok(button);
  (button.props.onPress ?? button.props.onClick)();
}
for (const app of ["desktop", "mobile"] as const) {
  test(`${app} usage loads only on demand and keeps exact measured totals distinct from quota`, async () => {
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
      assert.match(text, /9,007,199,254,740,994/);
      assert.match(text, /reported tokens/);
      assert.match(text, /1 request did not report/);
      assert.match(text, /Account limits stay in ChatGPT/);
      f.setToken("session-b");
      const changed = content(f.render("b"));
      assert.ok(!changed.includes("9,007"));
      assert.equal(f.calls.length, 1);
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
      assert.ok(!content(f.render("b")).includes("9,007"));
    } finally {
      f.close();
    }
  });
}
