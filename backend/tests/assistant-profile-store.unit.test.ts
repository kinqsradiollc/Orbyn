import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantProfileStore } from "@orbyn/api-client";
import type { AssistantProfiles } from "@orbyn/core";
const page = {
  observed_at: new Date().toISOString(),
  profiles: [],
} as unknown as AssistantProfiles;
test("account changes replace pending profile reads and clear previous evidence immediately", async () => {
  let owner = "owner-a";
  const resolvers: ((value: AssistantProfiles) => void)[] = [];
  const signals: AbortSignal[] = [];
  const store = new AssistantProfileStore(
    {
      assistantProfiles: (signal) => {
        signals.push(signal!);
        return new Promise((resolve) => resolvers.push(resolve));
      },
    },
    () => owner,
  );
  const initial = store.refresh();
  resolvers[0](page);
  await initial;
  const previous = store.refresh();
  owner = "owner-b";
  const current = store.refresh();
  assert.notEqual(current, previous);
  assert.equal(signals[1].aborted, true);
  assert.equal(signals.length, 3);
  assert.deepEqual(store.getSnapshot(), {
    data: null,
    loading: true,
    error: false,
  });
  const nextPage = { ...page, observed_at: "2026-10-02T12:00:00.000Z" };
  resolvers[2](nextPage);
  await current;
  resolvers[1](page);
  await previous;
  assert.equal(store.getSnapshot().data, nextPage);
  assert.equal(store.getSnapshot().loading, false);
});
test("profile store coalesces requests, cancels and fences closed generations", async () => {
  const resolvers: ((value: AssistantProfiles) => void)[] = [];
  const signals: AbortSignal[] = [];
  const store = new AssistantProfileStore({
    assistantProfiles: (signal) => {
      signals.push(signal!);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  const old = store.refresh();
  assert.equal(store.refresh(), old);
  assert.equal(signals.length, 1);
  store.reset();
  assert.equal(signals[0].aborted, true);
  const next = store.refresh();
  resolvers[1](page);
  await next;
  resolvers[0]({ ...page, observed_at: "2000-01-01T00:00:00.000Z" });
  await old;
  assert.equal(store.getSnapshot().data, page);
  unsubscribe();
  const count = updates;
  store.reset();
  assert.equal(updates, count);
});
test("errors clear stale work and changed sessions cannot restore a previous owner's data", async () => {
  let owner = "owner-a";
  let fail = false;
  let resolve: ((value: AssistantProfiles) => void) | undefined;
  const store = new AssistantProfileStore(
    {
      assistantProfiles: async () => {
        if (fail) throw new Error("fixture");
        return new Promise<AssistantProfiles>((done) => {
          resolve = done;
        });
      },
    },
    () => owner,
  );
  const read = store.refresh();
  resolve!(page);
  await read;
  assert.equal(store.getSnapshot().data, page);
  fail = true;
  await store.refresh();
  assert.deepEqual(store.getSnapshot(), {
    data: null,
    loading: false,
    error: true,
  });
  fail = false;
  const stale = store.refresh();
  owner = "owner-b";
  resolve!(page);
  await stale;
  assert.deepEqual(store.getSnapshot(), {
    data: null,
    loading: false,
    error: false,
  });
});
