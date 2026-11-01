import { test } from "node:test";
import assert from "node:assert/strict";
import type { SavedView, ViewDefinition } from "@orbyn/core";
import { ViewDraftStore } from "../../packages/api-client/src/view-draft-store.js";
const definition = (name: string) => ({ name }) as unknown as ViewDefinition;
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
test("view writes serialize and a confirmed older save never discards a newer draft", async () => {
  const first = deferred<ViewDefinition>(),
    second = deferred<ViewDefinition>();
  const calls: ViewDefinition[] = [];
  const store = new ViewDraftStore(
    async (_, value) => {
      calls.push(value);
      return calls.length === 1 ? first.promise : second.promise;
    },
    () => true,
    assert.fail,
  );
  const a = definition("first"),
    b = definition("newer");
  store.change("view", a, true, true);
  store.change("view", b, true, true);
  assert.deepEqual(calls, [a]);
  first.resolve(a);
  await settle();
  assert.deepEqual(calls, [a, b]);
  assert.equal(store.drafts.get("view"), b);
  assert.equal(store.saved.get("view")?.definition, a);
  assert.equal(store.states.view, "saving");
  second.resolve(b);
  await settle();
  assert.equal(store.drafts.has("view"), false);
  assert.equal(store.saved.get("view")?.definition, b);
  assert.equal(store.states.view, "saved");
  store.stop();
});
test("failed view write retains the draft for explicit retry", async () => {
  let fail = true;
  const errors: unknown[] = [];
  const store = new ViewDraftStore(
    async (_, value) => {
      if (fail) throw Error("offline");
      return value;
    },
    () => true,
    (e) => errors.push(e),
  );
  const draft = definition("retained");
  store.change("view", draft, true, true);
  await settle();
  assert.equal(store.states.view, "failed");
  assert.equal(store.drafts.get("view"), draft);
  assert.equal(errors.length, 1);
  fail = false;
  store.change("view", store.drafts.get("view")!, true, true);
  await settle();
  assert.equal(store.states.view, "saved");
  assert.equal(store.drafts.has("view"), false);
  store.stop();
});
test("account stop ignores late results and cannot erase the new account generation", async () => {
  const old = deferred<ViewDefinition>(),
    fresh = deferred<ViewDefinition>();
  let calls = 0;
  let current = true;
  const store = new ViewDraftStore(
    async () => (++calls === 1 ? old.promise : fresh.promise),
    () => current,
    assert.fail,
  );
  store.change("view", definition("old"), true, true);
  current = false;
  store.stop();
  current = true;
  store.start();
  const draft = definition("new account");
  store.change("view", draft, true, true);
  old.resolve(definition("old response"));
  await settle();
  assert.equal(store.drafts.get("view"), draft);
  assert.equal(store.saved.size, 0);
  fresh.resolve(draft);
  await settle();
  assert.equal(store.saved.get("view")?.definition, draft);
  store.stop();
});
test("closing a pane subscriber preserves pending workspace drafts; forgetting an item ignores late writes", async () => {
  const pending = deferred<ViewDefinition>();
  let notifications = 0;
  const store = new ViewDraftStore(
    () => pending.promise,
    () => true,
    assert.fail,
  );
  const unsubscribe = store.subscribe(() => notifications++);
  const draft = definition("pending");
  store.change("view", draft, true, true);
  unsubscribe();
  const atClose = notifications;
  assert.equal(store.drafts.get("view"), draft);
  pending.resolve(draft);
  await settle();
  assert.equal(notifications, atClose);
  assert.equal(store.saved.get("view")?.definition, draft);
  store.stop();
  const forgotten = deferred<ViewDefinition>();
  const other = new ViewDraftStore(
    () => forgotten.promise,
    () => true,
    assert.fail,
  );
  other.change("gone", draft, true, true);
  other.forget("gone");
  forgotten.resolve(draft);
  await settle();
  assert.equal(other.saved.has("gone"), false);
  assert.equal(other.drafts.has("gone"), false);
  other.stop();
});

test("CAS unknown cannot replay against the original revision and preserves newer drafts on authoritative reconciliation", async () => {
  const original = definition("original"),
    submitted = definition("submitted"),
    newer = definition("newer");
  let current = { id: "view", definition: original, version: 10 } as SavedView,
    calls = 0;
  const errors: unknown[] = [];
  const store = new ViewDraftStore(
    async (_id, _definition, base) => {
      assert.equal(base, 10);
      calls++;
      throw Error("connection lost after dispatch");
    },
    () => true,
    (error) => errors.push(error),
    async () => current,
  );
  store.observe(current);
  store.change("view", submitted, true, true);
  await settle();
  assert.equal(store.states.view, "uncertain");
  store.change("view", newer, true, true);
  await settle();
  assert.equal(calls, 1);
  await store.check("view");
  assert.equal(store.states.view, "uncertain");
  assert.equal(store.canRetry("view"), false);
  current = { ...current, definition: submitted, version: 11 };
  await store.check("view");
  assert.equal(store.drafts.get("view"), newer);
  assert.equal(store.states.view, "failed");
  assert.equal(store.canRetry("view"), true);
  assert.equal(store.saved.get("view")?.definition, submitted);
  assert.ok(errors.length >= 2);
  store.stop();
});

test("wrong successful receipt remains unknown and cannot remove the submitted draft", async () => {
  const draft = definition("own");
  const store = new ViewDraftStore(
    async () => ({ definition: definition("wrong"), version: 11 }),
    () => true,
    () => {},
    async () =>
      ({
        id: "view",
        definition: definition("base"),
        version: 10,
      }) as SavedView,
  );
  store.observe({
    id: "view",
    definition: definition("base"),
    version: 10,
  } as SavedView);
  store.change("view", draft, true, true);
  await settle();
  assert.equal(store.states.view, "uncertain");
  assert.equal(store.drafts.get("view"), draft);
  await store.check("view");
  assert.equal(store.states.view, "uncertain");
  store.stop();
});

test("a stale library row cannot roll back a confirmed definition or its next CAS base", async () => {
  const base = definition("base"),
    first = definition("saved"),
    next = definition("newer");
  const bases: (number | undefined)[] = [];
  const store = new ViewDraftStore(
    async (_id, definition, version) => {
      bases.push(version);
      return { definition, version: (version ?? 0) + 1 };
    },
    () => true,
    assert.fail,
    async () => ({ id: "view", definition: base, version: 10 }) as SavedView,
  );
  const old = { id: "view", definition: base, version: 10 } as SavedView;
  store.observe(old);
  store.change("view", first, true, true);
  await settle();
  store.observe(old);
  assert.equal(store.definitionFor(old), first);
  store.change("view", next, true, true);
  await settle();
  assert.deepEqual(bases, [10, 11]);
  assert.equal(store.definitionFor(old), next);
  store.stop();
});

test("a competing advanced revision needs explicit retained-draft save, not an automatic typing replay", async () => {
  const first = definition("pending"),
    changed = definition("new typing"),
    server = definition("other editor");
  let current = {
      id: "view",
      definition: definition("base"),
      version: 10,
    } as SavedView,
    calls = 0;
  const store = new ViewDraftStore(
    async (_id, definition, base) => {
      if (++calls === 1) throw Error("unknown");
      return { definition, version: (base ?? 0) + 1 };
    },
    () => true,
    () => {},
    async () => current,
  );
  store.observe(current);
  store.change("view", first, true, true);
  await settle();
  current = { ...current, definition: server, version: 11 };
  await store.check("view");
  store.change("view", changed, true);
  await settle();
  assert.equal(calls, 1);
  assert.equal(store.drafts.get("view"), changed);
  store.change("view", changed, true, true);
  await settle();
  assert.equal(calls, 2);
  assert.equal(store.states.view, "saved");
  store.stop();
});
