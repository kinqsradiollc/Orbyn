import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
async function fixture(app: "desktop" | "mobile") {
  const base =
    app === "desktop"
      ? "desktop/src/features/settings"
      : "mobile/src/screens/settings";
  const compiled = ts.transpileModule(
    await readFile(
      new URL(`../../${base}/AiProviderChoice.tsx`, import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const saved = { connection_id: randomUUID(), executor_id: randomUUID() };
  const inspected = { connection_id: randomUUID(), executor_id: randomUUID() };
  const choice = {
    primary: "chatgpt",
    ...saved,
    fallback_to_default: false,
    version: 1,
  };
  let cursor = 0,
    token = "a-token",
    effects: (() => void)[] = [],
    reads = 0;
  let pendingWrite: Promise<unknown> | null = null;
  const state: any[] = [],
    deps: any[] = [],
    cleanups: any[] = [],
    writes: any[] = [],
    exports: any = {};
  const jsx = (type: any, props: any) => ({ type, props });
  runInNewContext(compiled, {
    exports,
    AbortController,
    require(id: string) {
      if (id === "react/jsx-runtime")
        return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (id === "react")
        return {
          useState: (initial: any) => {
            const n = cursor++;
            if (!(n in state)) state[n] = initial;
            return [
              state[n],
              (v: any) => {
                state[n] = typeof v === "function" ? v(state[n]) : v;
              },
            ];
          },
          useRef: (initial: any) => {
            const n = cursor++;
            if (!(n in state)) state[n] = { current: initial };
            return state[n];
          },
          useEffect: (fn: any, d: any[]) => {
            const n = cursor++;
            if (!deps[n] || d.some((v, i) => v !== deps[n][i])) {
              deps[n] = d;
              effects.push(() => {
                cleanups[n]?.();
                cleanups[n] = fn();
              });
            }
          },
        };
      if (id.endsWith("/api"))
        return {
          client: {
            aiProviderChoice: async () => {
              reads++;
              return choice;
            },
            saveAiProviderChoice: async (v: any) => {
              writes.push(v);
              if (pendingWrite) await pendingWrite;
              return { ...choice, ...v, version: 2 };
            },
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
      if (id.endsWith("/errors")) return { errorText: () => "Save failed" };
      if (id === "react-native")
        return { View: "View", Text: "Text", Switch: "Switch" };
      if (id.endsWith("/SmallAction")) return { SmallAction: "SmallAction" };
      if (id.endsWith("/styles"))
        return { shared: { small: {}, body: {}, label: {} } };
      if (id.endsWith("/theme")) return { colors: { accent: "fixture" } };
      if (id === "@orbyn/core") return {};
      throw new Error(id);
    },
  });
  return {
    saved,
    inspected,
    writes,
    reads: () => reads,
    holdWrites: (pending: Promise<unknown>) => {
      pendingWrite = pending;
    },
    setToken: (v: string) => {
      token = v;
    },
    close: () => cleanups.forEach((f) => f?.()),
    render: (userId: string) => {
      cursor = 0;
      effects = [];
      const tree = exports.AiProviderChoiceControls({
        userId,
        selection: inspected,
      });
      effects.forEach((f) => f());
      return tree;
    },
  };
}
function nodes(v: any): any[] {
  if (!v || typeof v !== "object") return [];
  if (Array.isArray(v)) return v.flatMap(nodes);
  return [v, ...nodes(v.props?.children)];
}
for (const app of ["desktop", "mobile"] as const) {
  test(`${app} fallback changes preserve the saved provider when another device is inspected`, async () => {
    const f = await fixture(app);
    try {
      f.render("a");
      await Promise.resolve();
      const tree = f.render("a");
      const toggle = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "input" && n.props.type === "checkbox"
          : n.type === "Switch",
      );
      assert.ok(toggle);
      if (app === "desktop")
        toggle.props.onChange({ target: { checked: true } });
      else toggle.props.onValueChange(true);
      assert.equal(f.writes.length, 1);
      assert.equal(f.writes[0].connection_id, f.saved.connection_id);
      assert.equal(f.writes[0].executor_id, f.saved.executor_id);
      assert.equal(f.writes[0].fallback_to_default, true);
      assert.notEqual(f.writes[0].executor_id, f.inspected.executor_id);
    } finally {
      f.close();
    }
  });
  test(`${app} retained provider actions cannot mutate a replacement account`, async () => {
    const f = await fixture(app);
    try {
      f.render("a");
      await Promise.resolve();
      const tree = f.render("a");
      const button = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "button" && n.props.children === "Orbyn default"
          : n.props?.label === "Orbyn default",
      );
      assert.ok(button);
      const action = button.props.onClick ?? button.props.onPress;
      f.setToken("b-token");
      f.render("b");
      action();
      assert.equal(f.writes.length, 0);
    } finally {
      f.close();
    }
  });
}

for (const app of ["desktop", "mobile"] as const) {
  test(`${app} reloads provider choice on a new session for the same user`, async () => {
    const f = await fixture(app);
    try {
      f.render("same-user");
      await Promise.resolve();
      assert.equal(f.reads(), 1);
      f.setToken("new-session");
      f.render("same-user");
      await Promise.resolve();
      assert.equal(f.reads(), 2);
      const tree = f.render("same-user");
      const button = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "button" && n.props.children === "Orbyn default"
          : n.props?.label === "Orbyn default",
      );
      assert.equal(button.props.disabled, false);
    } finally {
      f.close();
    }
  });
  test(`${app} serializes provider mutations before React rerenders`, async () => {
    const f = await fixture(app);
    let release!: () => void;
    f.holdWrites(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      f.render("a");
      await Promise.resolve();
      const tree = f.render("a");
      const button = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "button" && n.props.children === "Orbyn default"
          : n.props?.label === "Orbyn default",
      );
      const action = button.props.onClick ?? button.props.onPress;
      action();
      action();
      assert.equal(f.writes.length, 1);
    } finally {
      release();
      await Promise.resolve();
      f.close();
    }
  });
}
