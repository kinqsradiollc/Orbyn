import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
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
