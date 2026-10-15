import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewDefinition } from "@orbyn/core";
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
