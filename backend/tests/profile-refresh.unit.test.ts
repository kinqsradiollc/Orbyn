import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function mount(me: () => Promise<unknown>) {
  const effects: (() => (() => void) | void)[] = [];
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const timers: (() => void)[] = [];
  const react = {
    useState(initial: unknown) {
      const i = states.length;
      states.push(typeof initial === "function" ? initial() : initial);
      return [
        states[i],
        (value: unknown) => {
          states[i] = value;
        },
      ];
    },
    useRef(current: unknown) {
      const ref = { current };
      refs.push(ref);
      return ref;
    },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => (() => void) | void) => effects.push(fn),
  };
  const source = readFileSync(
    new URL("../../desktop/src/hooks/usePlanner.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: { usePlanner?: () => { refresh: () => Promise<void> } } = {};
  runInNewContext(compiled, {
    exports,
    document: { visibilityState: "visible" },
    require: (id: string) =>
      id === "react"
        ? react
        : id.endsWith("/api")
          ? {
              client: {
                me,
                listAllItems: async () => {
                  throw new Error("Planner unavailable");
                },
              },
            }
          : id.endsWith("/session")
            ? { session: { get: () => "account-a", clear: () => {} } }
            : id.endsWith("/errors")
              ? { errorText: () => "Profile request failed" }
              : {},
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
  });
  const planner = exports.usePlanner!();
  const effect = effects.find((fn) => fn.toString().includes("loadProfile"));
  assert.ok(
    effect,
    "profile must have its own effect independent of planner reads",
  );
  const cleanup = effect();
  return { states, refs, timers, cleanup, planner };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("profile displays without invoking or waiting for planner data", async () => {
  const profile = { id: "a", name: "Account A" };
  const fixture = mount(async () => profile);
  await assert.rejects(fixture.planner.refresh(), /Planner unavailable/);
  await tick();
  assert.equal(fixture.states[1], profile);
  assert.equal(fixture.timers.length, 1);
  fixture.cleanup?.();
});

test("an expired profile session clears the signed-in state", async () => {
  const fixture = mount(async () => {
    throw { status: 401 };
  });
  await tick();
  assert.equal(fixture.states[0], "");
  assert.equal(fixture.states[1], null);
  fixture.cleanup?.();
});

test("profile failure is visible and schedules a retry", async () => {
  let attempts = 0;
  const profile = { id: "a" };
  const fixture = mount(async () => {
    if (++attempts === 1) throw { status: 429 };
    return profile;
  });
  await tick();
  assert.equal(fixture.states[1], null);
  assert.ok(fixture.states.includes("Profile request failed"));
  assert.equal(fixture.timers.length, 1);
  fixture.timers[0]();
  await tick();
  assert.equal(fixture.states[1], profile);
  fixture.cleanup?.();
});

test("a delayed profile cannot replace a switched account or an unmounted view", async () => {
  for (const unmount of [false, true]) {
    let resolve!: (value: unknown) => void;
    const fixture = mount(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    if (unmount) fixture.cleanup?.();
    else fixture.refs[0].current = "account-b";
    resolve({ id: "a" });
    await tick();
    assert.equal(fixture.states[1], null);
    if (!unmount) fixture.cleanup?.();
  }
});
