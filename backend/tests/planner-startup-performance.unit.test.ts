import { test } from "node:test";
import assert from "node:assert/strict";
import { plannerStartupFixture } from "./planner-startup-fixture.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("desktop tasks become usable before optional notifications settle, after team authority", async () => {
  const f = plannerStartupFixture();
  const work = f.refresh();
  f.completeItems();
  await flush();
  assert.equal(
    f.calls.includes("items"),
    false,
    "team authority still gates reconciliation",
  );
  f.teams.resolve([]);
  await flush();
  assert.equal(f.itemStore.getSnapshot()[0]?.title, "Usable task");
  assert.equal(f.state.itemRead.phase, "ready");
  assert.equal(f.state.notices[0].id, "previous-notice");
  f.notices.resolve([{ id: "new-notice" }]);
  await work;
  assert.equal(f.state.notices[0].id, "new-notice");
  assert.equal(f.state.loading, false);
});

test("desktop optional notice failure retains usable tasks and previous notices, and still reports failure", async () => {
  const f = plannerStartupFixture();
  const work = f.refresh();
  const failure = Object.assign(new Error("notifications unavailable"), {
    status: 503,
  });
  f.teams.resolve([]);
  f.completeItems();
  await flush();
  assert.equal(f.state.itemRead.phase, "ready");
  f.notices.reject(failure);
  await assert.rejects(work, /notifications unavailable/);
  assert.equal(f.itemStore.getSnapshot()[0]?.id, "primary-task");
  assert.equal(f.state.notices[0].id, "previous-notice");
});

test("desktop late reads after account change cannot publish either resource", async () => {
  const f = plannerStartupFixture();
  const work = f.refresh();
  f.teams.resolve([]);
  await flush();
  assert.equal(f.calls.includes("items"), true);
  f.switchOwner();
  f.completeItems();
  f.notices.resolve([{ id: "old-account-notice" }]);
  await work;
  assert.equal(f.itemStore.getSnapshot().length, 0);
  assert.equal(f.state.notices[0].id, "previous-notice");
  assert.notEqual(f.state.itemRead.phase, "ready");
});

test("desktop unauthorized notices retain auth failure handling without publishing their data", async () => {
  const f = plannerStartupFixture();
  const work = f.refresh();
  const failure = Object.assign(new Error("expired session"), { status: 401 });
  f.notices.reject(failure);
  await flush();
  assert.equal(f.reports[0], failure);
  f.teams.resolve([]);
  f.completeItems();
  await assert.rejects(work, /expired session/);
  assert.equal(f.state.notices[0].id, "previous-notice");
});
