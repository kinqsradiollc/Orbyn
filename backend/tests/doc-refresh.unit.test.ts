import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidateDocViews, watchDocRefresh } from "@orbyn/api-client";

test("same-version remote events and local decisions refresh without duplicate rows", async () => {
  let notify = () => {};
  const api = {
    watchDoc: (_id: string, fn: () => void) => {
      notify = fn;
      return () => {};
    },
  };
  let rows = ["request"];
  let observed: string[] = [];
  let loads = 0;
  const watcher = watchDocRefresh({
    api,
    id: "page",
    session: () => "owner",
    load: async () => {
      loads++;
      return rows;
    },
    received: (value) => {
      observed = value;
    },
    failed: () => assert.fail("unexpected error"),
  });
  await watcher.refresh();
  rows = ["request", "reply"];
  notify();
  notify();
  invalidateDocViews(api, "page");
  await watcher.refresh();
  assert.deepEqual(observed, rows);
  assert.equal(loads, 2);
  watcher.dispose();
});

test("navigation and account change fence late responses", async () => {
  for (const leave of ["dispose", "account"]) {
    let owner = "a";
    let resolve!: (value: string[]) => void;
    const api = { watchDoc: () => () => {} };
    const watcher = watchDocRefresh({
      api,
      id: "page",
      session: () => owner,
      load: () =>
        new Promise<string[]>((done) => {
          resolve = done;
        }),
      received: () => assert.fail("stale response"),
      failed: () => assert.fail("stale error"),
    });
    await Promise.resolve();
    if (leave === "dispose") watcher.dispose();
    else owner = "b";
    resolve(["private"]);
    await watcher.refresh();
    watcher.dispose();
  }
});

test("refresh errors retain prior data and allow retry", async () => {
  let broken = false;
  let value = "";
  let errors = 0;
  const watcher = watchDocRefresh({
    api: { watchDoc: () => () => {} },
    id: "page",
    session: () => "owner",
    load: async () => {
      if (broken) throw new Error("offline");
      return "saved reply";
    },
    received: (next) => {
      value = next;
    },
    failed: () => {
      errors++;
    },
  });
  await watcher.refresh();
  broken = true;
  await watcher.refresh();
  assert.equal(value, "saved reply");
  assert.equal(errors, 1);
  broken = false;
  await watcher.refresh();
  assert.equal(value, "saved reply");
  watcher.dispose();
});

test("a notification during a fetch queues a fresh read", async () => {
  let notify = () => {};
  let finish!: (rows: string[]) => void;
  let loads = 0;
  let observed: string[] = [];
  const watcher = watchDocRefresh({
    api: {
      watchDoc: (_id: string, callback: () => void) => {
        notify = callback;
        return () => {};
      },
    },
    id: "page",
    session: () => "owner",
    load: () =>
      ++loads === 1
        ? new Promise<string[]>((done) => {
            finish = done;
          })
        : Promise.resolve(["new reply"]),
    received: (rows) => {
      observed = rows;
    },
    failed: () => assert.fail("unexpected failure"),
  });
  await Promise.resolve();
  notify();
  notify();
  finish(["old thread"]);
  await watcher.refresh();
  assert.equal(loads, 2);
  assert.deepEqual(observed, ["new reply"]);
  watcher.dispose();
});
