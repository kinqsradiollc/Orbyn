import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { deferred } from "./planner-startup-fixture.js";

/** Hook lifecycle fixture: preserve state/dependency slots and explicitly inspect the render before effects. */
function fixture() {
  let binding = { token: "A", generation: 1 };
  const requests: {
    feed: ReturnType<typeof deferred<any>>;
    today: ReturnType<typeof deferred<any>>;
  }[] = [];
  const slots: any[] = [];
  let at = 0;
  let effects: (() => void)[] = [];
  const same = (a: unknown[], b: unknown[]) =>
    a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const memo = (fn: () => unknown, deps: unknown[]) => {
    const index = at++;
    if (!slots[index] || !same(slots[index].deps, deps))
      slots[index] = { deps, value: fn() };
    return slots[index].value;
  };
  const react = {
    useState: (initial: unknown) => {
      const index = at++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value: unknown) => {
          slots[index] =
            typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useRef: (value: unknown) => {
      const index = at++;
      return (slots[index] ??= { current: value });
    },
    useMemo: memo,
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => {
      at++;
      return snapshot();
    },
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
      const index = at++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL(
          "../../desktop/src/features/planner/usePlannedData.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      },
    ).outputText,
    {
      module,
      exports: module.exports,
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      document: {
        visibilityState: "visible",
        addEventListener() {},
        removeEventListener() {},
      },
      require: (id: string) =>
        id === "react"
          ? react
          : id.endsWith("/session")
            ? {
                session: { binding: () => binding },
                onSessionChange: () => () => {},
              }
            : id.endsWith("/api")
              ? {
                  client: {
                    planned: () => {
                      const pair = {
                        feed: deferred<any>(),
                        today: deferred<any>(),
                      };
                      requests.push(pair);
                      return pair.feed.promise;
                    },
                    today: () => requests.at(-1)!.today.promise,
                  },
                }
              : id === "@orbyn/core"
                ? {
                    dayBounds: () => ({
                      from: new Date(0),
                      to: new Date(86400000),
                    }),
                  }
                : id.endsWith("/live")
                  ? { onLive: () => () => {} }
                  : { deviceTimeZone: () => "UTC" },
    },
  );
  const flushEffects = () => {
    const queued = effects;
    effects = [];
    queued.forEach((fn) => fn());
  };
  return {
    requests,
    flushEffects,
    render(token = binding.token, flush = true) {
      at = 0;
      const result = module.exports.usePlannedData(token, 0);
      if (flush) flushEffects();
      return result;
    },
    owner(token: string) {
      binding = { token, generation: binding.generation + 1 };
    },
  };
}
const tick = () => new Promise<void>((yes) => setImmediate(yes));
test("planned feed and Today still publish as one completed pair", async () => {
  const f = fixture();
  f.render();
  f.requests[0].today.resolve({ label: "today A" });
  await tick();
  assert.equal(f.render().today, null);
  f.requests[0].feed.resolve({ tasks: [] });
  await tick();
  assert.equal(f.render().today.label, "today A");
  assert.equal(f.render().ready, true);
});
for (const next of ["B", "A"])
  test(`planned records hide before owner-change effects and stale responses cannot restore them (${next})`, async () => {
    const f = fixture();
    f.render();
    f.requests[0].feed.resolve({ tasks: [] });
    f.requests[0].today.resolve({ label: "old private Today" });
    await tick();
    const old = f.render();
    assert.equal(old.today.label, "old private Today");
    const stale = old.reload();
    f.owner(next);
    const immediate = f.render(next, false);
    assert.equal(immediate.today, null);
    assert.equal(immediate.feed, null);
    assert.equal(immediate.ready, false);
    f.flushEffects();
    await old.reload();
    assert.equal(
      f.requests.length,
      3,
      "a retained old-owner callback cannot dispatch or invalidate current work",
    );
    f.requests[1].feed.resolve({ tasks: [] });
    f.requests[1].today.resolve({ label: "late old private Today" });
    await stale;
    f.requests[2].feed.reject(new Error("new owner's feed unavailable"));
    f.requests[2].today.reject(new Error("new owner's Today unavailable"));
    await tick();
    const current = f.render();
    assert.equal(
      current.today,
      null,
      "failures cannot use another generation's fallback",
    );
    assert.equal(current.feed, null);
    assert.equal(
      current.ready,
      true,
      "current failure still completes the paired compatibility read",
    );
  });
