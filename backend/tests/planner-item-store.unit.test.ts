import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PlannerItemStore,
  PLANNER_RECONCILE_MS,
} from "../../packages/api-client/src/planner-item-store.js";
import type { Item } from "@orbyn/core";
const at = "2026-10-26T00:00:00.000Z";
const item = (id: string, version = 1, extra: Partial<Item> = {}): Item =>
  ({
    id,
    version,
    title: id,
    created_at: at,
    updated_at: at,
    ...extra,
  }) as Item;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture() {
  let clock = 0,
    binding = 1;
  const calls: { kind: string; args?: any; options?: any }[] = [];
  let full: Item[] = [item("a")];
  let delta: any = {
    items: [],
    deleted: [],
    next_cursor: "cursor1",
    has_more: false,
  };
  const api = {
    async reconcileItems() {
      calls.push({ kind: "full" });
      return { items: full, updated_after: at };
    },
    async syncItems(args: any, options: any) {
      calls.push({ kind: "delta", args, options });
      return delta;
    },
    async listAllItems() {
      calls.push({ kind: "legacy" });
      return full;
    },
  };
  const store = new PlannerItemStore(
    api as any,
    () => binding,
    () => clock,
  );
  return {
    api,
    store,
    calls,
    setFull: (value: Item[]) => {
      full = value;
    },
    setDelta: (value: any) => {
      delta = value;
    },
    advance: (n: number) => {
      clock += n;
    },
    switch: () => {
      binding++;
    },
  };
}
test("idle polls use bounded primary deltas and reconcile at the five-minute deadline", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  for (let i = 0; i < 9; i++) {
    f.advance(30_000);
    await f.store.refresh("scope");
  }
  assert.equal(f.calls.filter((c) => c.kind === "full").length, 1);
  assert.equal(f.calls.filter((c) => c.kind === "delta").length, 9);
  for (const c of f.calls.filter((c) => c.kind === "delta")) {
    assert.equal(c.options.fresh, true);
    assert.equal(c.options.headers["x-orbyn-consistency"], "primary");
  }
  f.advance(30_000);
  await f.store.refresh("scope");
  assert.equal(f.calls.filter((c) => c.kind === "full").length, 2);
  assert.equal(f.store.nextReconcileIn(), PLANNER_RECONCILE_MS);
});
test("delta pages and their cursor settle atomically after the last page", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  let calls = 0;
  f.api.syncItems = async (args: any) => {
    if (++calls === 1)
      return {
        items: [item("b")],
        deleted: [],
        next_cursor: "partial",
        has_more: true,
      };
    throw new Error("second page offline");
  };
  await assert.rejects(f.store.refresh("scope"), /offline/);
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["a"],
  );
  f.api.syncItems = async (args: any) => {
    assert.equal(args.cursor, undefined);
    assert.ok(args.updated_after);
    return { items: [], deleted: [], next_cursor: "done", has_more: false };
  };
  await f.store.refresh("scope");
});
test("scope changes and unknown access scope force authoritative removal and bootstrap", async () => {
  const f = fixture();
  await f.store.refresh("teamA");
  f.setFull([item("b")]);
  await f.store.refresh("teamB");
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["b"],
  );
  f.setFull([]);
  await f.store.refresh(null);
  assert.deepEqual(f.store.getSnapshot(), []);
  assert.equal(f.calls.filter((c) => c.kind === "delta").length, 0);
});
test("account switch fences late snapshots and offline seeds cannot authorize deltas", async () => {
  const f = fixture(),
    late = deferred<{ items: Item[]; updated_after: string }>();
  f.api.reconcileItems = async () => late.promise;
  const old = f.store.refresh("scope");
  f.switch();
  f.store.reset();
  f.store.seed([item("offlineB")]);
  late.resolve({ items: [item("privateA")], updated_after: at });
  await old;
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["offlineB"],
  );
  f.api.reconcileItems = async () => ({
    items: [item("B")],
    updated_after: at,
  });
  await f.store.refresh("scope");
  assert.equal(f.calls.filter((c) => c.kind === "delta").length, 0);
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["B"],
  );
});
test("same-version ordering updates apply, stale records do not regress, and tombstones remove", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  const moved = item("a", 1, {
    position: 20,
    updated_at: "2026-10-26T00:00:01.000Z",
  });
  f.setDelta({
    items: [moved],
    deleted: [],
    next_cursor: "move",
    has_more: false,
  });
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot()[0].position, 20);
  f.setDelta({
    items: [item("a")],
    deleted: [],
    next_cursor: "duplicate",
    has_more: false,
  });
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot()[0].position, 20);
  f.setDelta({
    items: [],
    deleted: [{ id: "a", deleted_at: "2026-10-26T00:00:02.000Z" }],
    next_cursor: "deleted",
    has_more: false,
  });
  await f.store.refresh("scope");
  assert.deepEqual(f.store.getSnapshot(), []);
});
test("a late transaction missed by legacy deltas converges at reconciliation", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  f.setFull([item("a", 2, { title: "Late commit" })]);
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot()[0].title, "a");
  f.advance(PLANNER_RECONCILE_MS);
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot()[0].title, "Late commit");
});
test("expired cursors reconcile; old servers retain full polling", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  f.api.syncItems = async () => {
    throw Object.assign(new Error("expired"), { status: 410 });
  };
  f.setFull([item("b")]);
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot()[0].id, "b");
  f.api.reconcileItems = async () => {
    throw Object.assign(new Error("older server"), { status: 404 });
  };
  await f.store.refresh("scope", true);
  await f.store.refresh("scope");
  assert.equal(f.calls.filter((c) => c.kind === "legacy").length, 2);
});
test("unchanged deltas keep snapshot identity and malformed cursors never publish partial data", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  const snapshot = f.store.getSnapshot();
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot(), snapshot);
  f.setDelta({
    items: [item("bad")],
    deleted: [],
    next_cursor: "cursor1",
    has_more: true,
  });
  await assert.rejects(f.store.refresh("scope"), /did not advance/);
  assert.equal(f.store.getSnapshot(), snapshot);
});

test("known membership loss purges visible items even if replacement read fails", async () => {
  const f = fixture();
  f.setFull([item("private"), item("revoked", 1, { team_id: "old-team" })]);
  await f.store.refresh("old", false, ["old-team"]);
  f.api.reconcileItems = async () => {
    throw new Error("read failed");
  };
  await assert.rejects(f.store.refresh("new", false, []), /read failed/);
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["private"],
  );
});

test("known access loss fences a late read while disk purge blocks its replacement", async () => {
  const f = fixture();
  f.setFull([item("private"), item("revoked", 1, { team_id: "old" })]);
  await f.store.refresh("old", false, ["old"]);
  const late = deferred<{ items: Item[]; updated_after: string }>();
  f.api.reconcileItems = async () => late.promise;
  const old = f.store.refresh("old", true, ["old"]);
  f.store.restrictTeams([]);
  late.resolve({
    items: [item("revoked", 2, { team_id: "old" })],
    updated_after: at,
  });
  await old;
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["private"],
  );
});

test("a successful delta crossing the deadline immediately reconciles", async () => {
  const f = fixture();
  await f.store.refresh("scope");
  f.advance(PLANNER_RECONCILE_MS - 100);
  f.setFull([item("fresh")]);
  f.api.syncItems = async () => {
    f.advance(101);
    return { items: [], deleted: [], next_cursor: "end", has_more: false };
  };
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot()[0].id, "fresh");
  assert.equal(f.calls.filter((c) => c.kind === "full").length, 2);
  assert.equal(f.store.nextReconcileIn(), PLANNER_RECONCILE_MS);
});

test("empty deltas preserve authoritative sub-millisecond creation order", async () => {
  const f = fixture();
  f.setFull([item("z"), item("a")]);
  await f.store.refresh("scope");
  const snapshot = f.store.getSnapshot();
  await f.store.refresh("scope");
  assert.equal(f.store.getSnapshot(), snapshot);
  assert.deepEqual(
    f.store.getSnapshot().map((i) => i.id),
    ["z", "a"],
  );
});
