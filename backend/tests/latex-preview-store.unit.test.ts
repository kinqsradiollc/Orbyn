import { test } from "node:test";
import assert from "node:assert/strict";
import { LatexPreviewStore } from "../../packages/api-client/src/latex-preview-store.js";
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve!: (value: Blob) => void, reject!: (error: Error) => void;
  const promise = new Promise<Blob>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
test("one saved document preview survives Note/source changes without duplicate compilation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  let calls = 0;
  const pdf = new Blob(["%PDF-current"]);
  const store = new LatexPreviewStore(async () => {
    calls++;
    return pdf;
  });
  store.update("Saved TeX", false);
  t.mock.timers.tick(1200);
  await settle();
  assert.equal(calls, 0);
  store.update("Saved TeX", true);
  t.mock.timers.tick(1199);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().pdf?.blob, pdf);
  store.update("Saved TeX", false);
  store.update("Saved TeX", true);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(
    calls,
    1,
    "opening Note or the source view reuses the same exact-source PDF",
  );
  store.stop();
});
test("newer source aborts in-flight work and an ignored abort cannot publish stale output", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const first = deferred(),
    second = deferred();
  const signals: AbortSignal[] = [];
  const store = new LatexPreviewStore(async (_, signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  });
  store.update("Old", true);
  t.mock.timers.tick(1200);
  assert.equal(signals.length, 1);
  store.update("New", true);
  assert.equal(signals[0].aborted, true);
  first.resolve(new Blob(["%PDF-old"]));
  await settle();
  assert.equal(store.getSnapshot().pdf, null);
  t.mock.timers.tick(3999);
  assert.equal(signals.length, 1);
  t.mock.timers.tick(1);
  assert.equal(signals.length, 2);
  second.resolve(new Blob(["%PDF-new"]));
  await settle();
  assert.equal(store.getSnapshot().pdf?.source, "New");
  assert.equal(store.getSnapshot().busy, false);
  store.stop();
});
test("failed new source retains the last valid PDF, reports failure and retries explicitly", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  let fail = false,
    calls = 0;
  const store = new LatexPreviewStore(async () => {
    calls++;
    if (fail) throw Error("Invalid TeX");
    return new Blob(["%PDF-valid"]);
  });
  store.update("Valid", true);
  t.mock.timers.tick(1200);
  await settle();
  const valid = store.getSnapshot().pdf;
  fail = true;
  store.update("Broken", true);
  t.mock.timers.tick(4000);
  await settle();
  assert.equal(store.getSnapshot().pdf, valid);
  assert.equal(store.getSnapshot().error, "Invalid TeX");
  assert.equal(store.getSnapshot().busy, false);
  fail = false;
  store.retry();
  await settle();
  assert.equal(calls, 3);
  assert.equal(store.getSnapshot().pdf?.source, "Broken");
  assert.equal(store.getSnapshot().error, "");
  store.stop();
});
test("account/document teardown cancels timers and ignores late results; restarting starts fresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const pending = deferred();
  let signal: AbortSignal | undefined;
  const store = new LatexPreviewStore(async (_, s) => {
    signal = s;
    return pending.promise;
  });
  store.update("Private source", true);
  t.mock.timers.tick(1200);
  store.stop();
  assert.equal(signal?.aborted, true);
  pending.resolve(new Blob(["%PDF-private"]));
  await settle();
  assert.equal(store.getSnapshot().pdf, null);
  assert.equal(store.getSnapshot().source, null);
  store.start();
  store.update("New owner", false);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(store.getSnapshot().pdf, null);
  store.stop();
});
