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
  let reply: ((value: any) => any) | null = null;
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
              const next = {
                primary: v.primary,
                connection_id: v.primary === "chatgpt" ? v.connection_id : null,
                executor_id: v.primary === "chatgpt" ? v.executor_id : null,
                fallback_to_default: v.fallback_to_default,
                version: v.expected_version + 1,
              };
              return reply ? reply(next) : next;
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
    setReply: (value: (next: any) => any) => {
      reply = value;
    },
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

for (const app of ["desktop", "mobile"] as const) {
  test(`${app} mismatched provider receipts invalidate the old revision until reload`, async () => {
    for (const field of [
      "connection_id",
      "executor_id",
      "fallback_to_default",
      "version",
      "primary",
      "failure",
    ] as const) {
      const f = await fixture(app);
      try {
        f.render("a");
        await Promise.resolve();
        f.setReply((next) => {
          if (field === "failure") throw new Error("409 conflict");
          return {
            ...next,
            [field]:
              field === "version"
                ? 99
                : field === "primary"
                  ? "default"
                  : field === "fallback_to_default"
                    ? false
                    : randomUUID(),
          };
        });
        let tree = f.render("a");
        const toggle = nodes(tree).find((n) =>
          app === "desktop"
            ? n.type === "input" && n.props.type === "checkbox"
            : n.type === "Switch",
        );
        if (app === "desktop")
          toggle.props.onChange({ target: { checked: true } });
        else toggle.props.onValueChange(true);
        await new Promise<void>((resolve) => setImmediate(resolve));
        // Retained pre-render callbacks cannot reuse an unconfirmed version.
        if (app === "desktop")
          toggle.props.onChange({ target: { checked: true } });
        else toggle.props.onValueChange(true);
        assert.equal(f.writes.length, 1, field);
        tree = f.render("a");
        const defaultButton = nodes(tree).find((n) =>
          app === "desktop"
            ? n.type === "button" && n.props.children === "Orbyn default"
            : n.props?.label === "Orbyn default",
        );
        assert.equal(defaultButton.props.disabled, true, field);
        const retainedAction =
          defaultButton.props.onClick ?? defaultButton.props.onPress;
        retainedAction();
        assert.equal(f.writes.length, 1, field);
        const reload = nodes(tree).find((n) =>
          app === "desktop"
            ? n.type === "button" && n.props.children === "Reload provider"
            : n.props?.label === "Reload provider",
        );
        assert.ok(reload, field);
        (reload.props.onClick ?? reload.props.onPress)();
        f.render("a");
        await Promise.resolve();
        tree = f.render("a");
        const loaded = nodes(tree).find((n) =>
          app === "desktop"
            ? n.type === "button" && n.props.children === "Orbyn default"
            : n.props?.label === "Orbyn default",
        );
        assert.equal(loaded.props.disabled, false, field);
      } finally {
        f.close();
      }
    }
  });
}

for (const app of ["desktop", "mobile"] as const) {
  test(`${app} confirmed default and ChatGPT receipts remain usable with the next version`, async () => {
    const f = await fixture(app);
    try {
      f.render("a");
      await Promise.resolve();
      let tree = f.render("a");
      let button = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "button" && n.props.children === "Orbyn default"
          : n.props?.label === "Orbyn default",
      );
      (button.props.onClick ?? button.props.onPress)();
      await new Promise<void>((resolve) => setImmediate(resolve));
      tree = f.render("a");
      button = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "button" && n.props.children === "ChatGPT"
          : n.props?.label === "ChatGPT",
      );
      assert.equal(button.props.disabled, false);
      (button.props.onClick ?? button.props.onPress)();
      await new Promise<void>((resolve) => setImmediate(resolve));
      tree = f.render("a");
      assert.equal(f.writes.length, 2);
      assert.equal(f.writes[1].expected_version, 2);
      assert.equal(f.writes[1].connection_id, f.inspected.connection_id);
      assert.equal(f.writes[1].executor_id, f.inspected.executor_id);
      assert.equal(f.writes[1].fallback_to_default, false);
      const selected = nodes(tree).find((n) =>
        app === "desktop"
          ? n.type === "button" && n.props.children === "ChatGPT"
          : n.props?.label === "ChatGPT · selected",
      );
      assert.ok(selected);
      if (app === "desktop") assert.equal(selected.props["aria-pressed"], true);
    } finally {
      f.close();
    }
  });
}
