import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import * as core from "@orbyn/core";
import ts from "typescript";
const source = readFileSync(
  new URL("../../mobile/src/lib/offlineCache.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const snapshot = (id: string, team = "teamA") => ({
  user: { id },
  items: [{ id: `item-${id}`, team_id: team }],
  teams: [{ id: team }],
  notices: [],
  lists: [],
  tags: [],
});
function fixture() {
  let saved: string | null = null,
    hold: Promise<void> | null = null,
    holdRead: Promise<void> | null = null,
    failed = false;
  const calls: string[] = [];
  const session = { userId: "A" as string | null, generation: 1 };
  const storage = {
    async getItem() {
      const value = saved;
      const waiting = holdRead;
      holdRead = null;
      if (waiting) await waiting;
      return value;
    },
    async setItem(_key: string, value: string) {
      calls.push("set");
      const waiting = hold;
      hold = null;
      if (waiting) await waiting;
      saved = value;
    },
    async removeItem() {
      calls.push("remove");
      if (failed) throw new Error("disk unavailable");
      saved = null;
    },
  };
  const exports: any = {};
  vm.runInNewContext(js, {
    exports,
    JSON,
    Promise,
    Error,
    Set,
    require: (name: string) => {
      if (name === "@react-native-async-storage/async-storage") return storage;
      if (name === "@orbyn/core")
        return {
          decodeSnapshot: (value: string | null) =>
            value ? JSON.parse(value) : null,
          encodeSnapshot: JSON.stringify,
        };
      if (name === "./session") return { session };
      if (name === "react-native") return { Platform: { OS: "ios" } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return {
    api: exports,
    session,
    calls,
    saved: () => (saved ? JSON.parse(saved) : null),
    seed: (value: unknown) => {
      saved = JSON.stringify(value);
    },
    hold: (promise: Promise<void>) => {
      hold = promise;
    },
    holdRead: (promise: Promise<void>) => {
      holdRead = promise;
    },
    fail: () => {
      failed = true;
    },
  };
}
test("revocation purge follows earlier writes and never deletes a later owner's snapshot", async () => {
  const f = fixture(),
    gate = deferred();
  f.hold(gate.promise);
  const old = f.api.saveCache(snapshot("A"));
  await Promise.resolve();
  const purge = f.api.purgeCacheTeams([]);
  f.session.userId = "B";
  f.session.generation++;
  const current = f.api.saveCache(snapshot("B", "teamB"));
  gate.resolve();
  await Promise.all([old, purge, current]);
  assert.equal(f.saved().user.id, "B");
  assert.ok(f.calls.includes("remove"));
});
test("queued stale saves cannot resurrect a revoked snapshot", async () => {
  const f = fixture(),
    gate = deferred();
  f.hold(gate.promise);
  const first = f.api.saveCache(snapshot("A"));
  await Promise.resolve();
  const stale = f.api.saveCache(snapshot("A"));
  const purge = f.api.purgeCacheTeams([]);
  f.session.generation++;
  gate.resolve();
  await Promise.all([first, stale, purge]);
  assert.equal(f.saved(), null);
});
test("purge failure is surfaced; an unrelated cached account is preserved", async () => {
  const f = fixture();
  f.seed(snapshot("B"));
  await f.api.purgeCacheTeams([]);
  assert.equal(f.saved().user.id, "B");
  f.seed(snapshot("A"));
  f.fail();
  await assert.rejects(f.api.purgeCacheTeams([]), /Unable to clear/);
});
test("logout clear queued for an old generation cannot erase a new account cache", async () => {
  const f = fixture();
  f.seed(snapshot("A"));
  const clearing = f.api.clearCache();
  f.session.generation++;
  f.session.userId = "B";
  const saving = f.api.saveCache(snapshot("B"));
  await Promise.all([clearing, saving]);
  assert.equal(f.saved().user.id, "B");
  assert.equal(f.calls.includes("remove"), false);
});

test("same-owner logout/login cannot let a queued purge erase the newer session save behind an old write", async () => {
  const f = fixture(),
    gate = deferred();
  f.hold(gate.promise);
  const old = f.api.saveCache(snapshot("A", "revoked"));
  await Promise.resolve(); // The old storage write has passed its generation check.
  const purge = f.api.purgeCacheTeams([]);
  f.session.userId = null;
  f.session.generation++;
  const clear = f.api.clearCache();
  f.session.userId = "A";
  f.session.generation++;
  const current = f.api.saveCache(snapshot("A", "newly-allowed"));
  gate.resolve();
  await Promise.all([old, purge, clear, current]);
  assert.equal(f.saved().user.id, "A");
  assert.equal(f.saved().items[0].team_id, "newly-allowed");
  assert.deepEqual(f.calls, ["set", "remove", "set"]);
});

test("a paused purge read finishes before the same owner's newer-session save can write", async () => {
  const f = fixture(),
    gate = deferred();
  f.seed(snapshot("A", "revoked"));
  f.holdRead(gate.promise);
  const purge = f.api.purgeCacheTeams([]);
  await Promise.resolve(); // Purge has read the old snapshot but has not removed it.
  f.session.userId = null;
  f.session.generation++;
  const clear = f.api.clearCache();
  f.session.userId = "A";
  f.session.generation++;
  const current = f.api.saveCache(snapshot("A", "newly-allowed"));
  await Promise.resolve();
  assert.equal(
    f.calls.length,
    0,
    "new save waits behind the purge's read/remove transaction",
  );
  assert.equal(f.saved().items[0].team_id, "revoked");
  gate.resolve();
  await Promise.all([purge, clear, current]);
  assert.equal(f.saved().items[0].team_id, "newly-allowed");
  assert.deepEqual(f.calls, ["remove", "set"]);
});

type Locks = { request<T>(name: string, run: () => Promise<T>): Promise<T> };
function lockManager() {
  const queues = new Map<string, Promise<void>>();
  const names: string[] = [];
  const locks: Locks = {
    request<T>(name: string, run: () => Promise<T>) {
      names.push(name);
      const result = (queues.get(name) ?? Promise.resolve()).then(run);
      queues.set(
        name,
        result.then(
          () => undefined,
          () => undefined,
        ),
      );
      return result;
    },
  };
  return { locks, names };
}
function realWebFixture(t: { after(cleanup: () => void): void }) {
  const require = createRequire(import.meta.url);
  const adapter = require("@react-native-async-storage/async-storage").default;
  const globals = globalThis as unknown as Record<string, unknown>;
  const previousWindow = globals.window;
  const values = new Map<string, string>();
  const calls: string[] = [];
  let failed = false;
  const label = (value?: string | null) =>
    core.decodeSnapshot(value)?.items[0]?.id ?? "null";
  globals.window = {
    localStorage: {
      getItem(key: string) {
        calls.push(`get:${label(values.get(key))}`);
        if (failed) throw Error("storage unavailable");
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        calls.push(`set:${label(value)}`);
        if (failed) throw Error("storage unavailable");
        values.set(key, value);
      },
      removeItem(key: string) {
        calls.push(`remove:${label(values.get(key))}`);
        if (failed) throw Error("storage unavailable");
        values.delete(key);
      },
    },
  };
  t.after(() => {
    if (previousWindow === undefined) delete globals.window;
    else globals.window = previousWindow;
  });
  const key = "orbyn-planner-cache";
  return {
    calls,
    values,
    fail() {
      failed = true;
    },
    seed(data: unknown) {
      values.set(key, core.encodeSnapshot(data as core.PlannerSnapshot));
      calls.length = 0;
    },
    saved() {
      return core.decodeSnapshot(values.get(key));
    },
    runtime(session: { userId: string; generation: number }, locks?: Locks) {
      const exports: any = {};
      vm.runInNewContext(js, {
        exports,
        Promise,
        JSON,
        Set,
        Error,
        navigator: { locks },
        require: (name: string) => {
          if (name === "@react-native-async-storage/async-storage")
            return { default: adapter, __esModule: true };
          if (name === "@orbyn/core") return core;
          if (name === "./session") return { session };
          if (name === "react-native") return { Platform: { OS: "web" } };
          throw Error(`Unexpected dependency ${name}`);
        },
      });
      return exports;
    },
  };
}
function realSnapshot(label: string, team?: string) {
  return {
    ...snapshot("A", team ?? "none"),
    items: [{ id: label, team_id: team ?? null }],
    teams: team ? [{ id: team }] : [],
    planned: null,
    today: null,
  };
}
test("real web adapter: cross-runtime purge cannot erase a newer same-owner snapshot", async (t) => {
  const f = realWebFixture(t),
    manager = lockManager();
  f.seed(realSnapshot("old-revoked", "gone"));
  const first = f.runtime({ userId: "A", generation: 1 }, manager.locks),
    second = f.runtime({ userId: "A", generation: 3 }, manager.locks);
  await Promise.all([
    first.purgeCacheTeams([]),
    second.saveCache(realSnapshot("fresh-private")),
  ]);
  assert.equal(f.saved()?.items[0].id, "fresh-private");
  assert.deepEqual(f.calls, [
    "get:old-revoked",
    "remove:old-revoked",
    "set:fresh-private",
  ]);
  assert.equal(new Set(manager.names).size, 1);
  assert.equal(manager.names.length, 2);
});
test("real web adapter: load and clear use the same origin lock as save/purge", async (t) => {
  const f = realWebFixture(t),
    manager = lockManager();
  f.seed(realSnapshot("old-revoked", "gone"));
  const first = f.runtime({ userId: "A", generation: 1 }, manager.locks),
    second = f.runtime({ userId: "A", generation: 1 }, manager.locks);
  const purge = first.purgeCacheTeams([]),
    load = second.loadCache();
  await purge;
  assert.equal(await load, null);
  await second.saveCache(realSnapshot("fresh-private"));
  assert.equal((await first.loadCache()).items[0].id, "fresh-private");
  await first.clearCache();
  assert.equal(f.saved(), null);
  assert.equal(manager.names.length, 5);
  assert.equal(new Set(manager.names).size, 1);
});
for (const unavailable of ["missing", "rejected"] as const)
  test(`real web adapter: ${unavailable} Web Locks fail closed without shared-key access`, async (t) => {
    const f = realWebFixture(t);
    f.seed(realSnapshot("old-revoked", "gone"));
    const locks =
      unavailable === "missing"
        ? undefined
        : ({
            request: async () => {
              throw Error("locks rejected");
            },
          } as Locks | undefined);
    const api = f.runtime({ userId: "A", generation: 1 }, locks);
    assert.equal(await api.loadCache(), null);
    await api.saveCache(realSnapshot("fresh-private"));
    await api.clearCache();
    if (unavailable === "rejected")
      await assert.rejects(api.purgeCacheTeams([]), /Unable to clear/);
    else await api.purgeCacheTeams([]);
    assert.equal(f.calls.length, 0);
    assert.equal(f.saved()?.items[0].id, "old-revoked");
  });
test("real web adapter: queued old-generation clear/save cannot delete or overwrite the relogged same-owner cache", async (t) => {
  const f = realWebFixture(t),
    manager = lockManager(),
    gate = deferred();
  const blocker = manager.locks.request(
    "orbyn-planner-cache",
    () => gate.promise,
  );
  const session = { userId: "A", generation: 1 };
  const api = f.runtime(session, manager.locks);
  f.seed(realSnapshot("old-revoked", "gone"));
  const staleSave = api.saveCache(realSnapshot("stale")),
    oldClear = api.clearCache();
  await Promise.resolve();
  assert.equal(
    manager.names.length,
    2,
    "stale save is waiting for the origin lock",
  );
  assert.equal(f.calls.length, 0);
  session.userId = "";
  session.generation++;
  session.userId = "A";
  session.generation++;
  const fresh = api.saveCache(realSnapshot("fresh-private"));
  gate.resolve();
  await Promise.all([blocker, staleSave, oldClear, fresh]);
  assert.equal(f.saved()?.items[0].id, "fresh-private");
  assert.deepEqual(f.calls, ["set:fresh-private"]);
});
test("real web adapter: storage errors remain best effort for load/save/clear and visible for purge", async (t) => {
  const f = realWebFixture(t),
    manager = lockManager();
  f.seed(realSnapshot("old-revoked", "gone"));
  f.fail();
  const api = f.runtime({ userId: "A", generation: 1 }, manager.locks);
  assert.equal(await api.loadCache(), null);
  await api.saveCache(realSnapshot("fresh-private"));
  await api.clearCache();
  await assert.rejects(api.purgeCacheTeams([]), /Unable to clear/);
});

test("real web adapter: signed-out writes/purges skip storage, while logout clear holds the origin lock", async (t) => {
  const f = realWebFixture(t),
    manager = lockManager();
  f.seed(realSnapshot("prior-owner"));
  const api = f.runtime({ userId: "", generation: 2 }, manager.locks);
  await api.saveCache(realSnapshot("invalid-signed-out"));
  await api.purgeCacheTeams([]);
  assert.equal(f.calls.length, 0);
  await api.clearCache();
  assert.equal(f.saved(), null);
  assert.deepEqual(f.calls, ["remove:prior-owner"]);
  assert.equal(manager.names.length, 2);
});
