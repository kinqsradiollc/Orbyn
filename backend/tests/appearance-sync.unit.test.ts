import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function fixture(blocked = false) {
  const data = new Map<string, string>();
  let systemDark = true;
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: systemDark }),
  });
  const states: { value: string }[] = [];
  const cleanups: (() => void)[] = [];
  const document = {
    documentElement: { dataset: {} as Record<string, string> },
    querySelector: () => ({ setAttribute() {} }),
  };
  const exports: any = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../../desktop/src/lib/theme.ts", import.meta.url),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      window,
      document,
      Event,
      localStorage: {
        getItem: (key: string) => {
          if (blocked) throw new Error("Blocked");
          return data.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
          if (blocked) throw new Error("Blocked");
          data.set(key, value);
        },
        removeItem: (key: string) => {
          if (blocked) throw new Error("Blocked");
          data.delete(key);
        },
      },
      require: (name: string) => {
        assert.equal(name, "react");
        return {
          useState: (initial: () => string) => {
            const state = { value: initial() };
            states.push(state);
            return [
              state.value,
              (value: string) => {
                state.value = value;
              },
            ];
          },
          useEffect: (effect: () => () => void) => cleanups.push(effect()),
        };
      },
    },
  );
  return {
    api: exports,
    setSystemDark: (value: boolean) => {
      systemDark = value;
    },
    data,
    window,
    states,
    document,
    cleanup: () => cleanups.forEach((fn) => fn()),
  };
}

test("appearance controls synchronize in one document and persist the choice", () => {
  const f = fixture();
  try {
    const [, change] = f.api.useTheme();
    f.api.useTheme();
    change("dark");
    assert.deepEqual(
      f.states.map((s) => s.value),
      ["dark", "dark"],
    );
    assert.equal(f.data.get("orbyn-theme"), "dark");
    assert.equal(f.document.documentElement.dataset.theme, "dark");
    change("light");
    assert.deepEqual(
      f.states.map((s) => s.value),
      ["light", "light"],
    );
    assert.equal(f.data.has("orbyn-theme"), false);
  } finally {
    f.cleanup();
  }
});

test("cross-tab storage changes refresh mounted controls and the applied palette", () => {
  const f = fixture();
  try {
    f.api.useTheme();
    f.data.set("orbyn-theme", "dark");
    const event = Object.assign(new Event("storage"), { key: "orbyn-theme" });
    f.window.dispatchEvent(event);
    assert.equal(f.states[0].value, "dark");
    assert.equal(f.document.documentElement.dataset.theme, "dark");
    f.cleanup();
    f.data.delete("orbyn-theme");
    f.window.dispatchEvent(event);
    assert.equal(
      f.states[0].value,
      "dark",
      "unmounted controls release subscriptions",
    );
  } finally {
    f.cleanup();
  }
});

test("appearance remains synchronized for this visit when storage is unavailable", () => {
  const f = fixture(true);
  try {
    const [, change] = f.api.useTheme();
    f.api.useTheme();
    change("dark");
    assert.deepEqual(
      f.states.map((s) => s.value),
      ["dark", "dark"],
    );
    assert.equal(f.api.savedTheme(), "dark");
  } finally {
    f.cleanup();
  }
});

test("public pages inherit the theme and sign-in renders one back action", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../desktop/src/${path}`, import.meta.url), "utf8");
  assert.doesNotMatch(source("features/home/HomePage.tsx"), /home theme-light/);
  const auth = source("features/auth/AuthPage.tsx");
  assert.equal(auth.match(/Back to Orbyn/g)?.length, 1);
  assert.doesNotMatch(auth, /auth-home-mobile/);
  for (const path of [
    "features/home/HomePage.tsx",
    "features/auth/AuthPage.tsx",
    "app/chrome/Topbar.tsx",
  ])
    assert.match(source(path), /<AppearanceControl/);
  assert.match(
    source("features/overview/overview.css"),
    /\.overview-workspace \.overview-aside \.upcoming \.date-tile\s*\{\s*border: 0;/,
  );
});

test("legacy System preferences migrate once and do not follow later device changes", () => {
  const f = fixture();
  f.data.set("orbyn-theme", "system");
  assert.equal(f.api.savedTheme(), "dark");
  assert.equal(f.data.get("orbyn-theme"), "dark");
  f.setSystemDark(false);
  assert.equal(f.api.savedTheme(), "dark");
});

test("appearance is an explicit accessible binary switch, including Settings", () => {
  const source = (path: string) =>
    readFileSync(new URL(`../../desktop/src/${path}`, import.meta.url), "utf8");
  const control = source("components/AppearanceControl.tsx");
  assert.match(control, /role="switch"/);
  assert.match(control, /aria-checked=\{dark\}/);
  assert.match(control, /change\(dark \? "light" : "dark"\)/);
  assert.doesNotMatch(control, /System|<Select/);
  assert.match(
    source("features/settings/SettingsView.tsx"),
    /<AppearanceControl/,
  );
  assert.doesNotMatch(source("main.tsx"), /followSystemTheme/);
});
