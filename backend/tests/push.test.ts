import assert from "node:assert/strict";
import { test } from "node:test";
import { sendPush } from "../src/worker/channels/push.js";

const notification = {
  item_id: "planner-item",
  destination: "ExponentPushToken[unit-test]",
  title: "Coming up",
  body: "Review your plan",
  receipt_id: null,
};

test("push acceptance requires a separate successful receipt before delivery", async (t) => {
  const calls: { url: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    assert.ok(init.signal);
    return Response.json({
      data:
        calls.length === 1
          ? { status: "ok", id: "receipt-1" }
          : { "receipt-1": { status: "ok" } },
    });
  });
  assert.deepEqual(await sendPush(notification, false), {
    kind: "ticket",
    receiptId: "receipt-1",
  });
  assert.deepEqual(
    await sendPush({ ...notification, receipt_id: "receipt-1" }, true),
    { kind: "delivered" },
  );
  assert.ok(calls[0].url.endsWith("/send"));
  assert.deepEqual(calls[0].body, {
    to: notification.destination,
    title: notification.title,
    body: notification.body,
    data: { itemId: notification.item_id },
    sound: "default",
  });
  assert.ok(calls[1].url.endsWith("/getReceipts"));
  assert.deepEqual(calls[1].body, { ids: ["receipt-1"] });
});

test("unregistered devices are terminal at either push stage", async (t) => {
  const error = { status: "error", details: { error: "DeviceNotRegistered" } };
  for (const checking of [false, true]) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json({ data: checking ? { receipt: error } : error }),
    );
    assert.deepEqual(
      await sendPush({ ...notification, receipt_id: "receipt" }, checking),
      { kind: "unregistered" },
    );
    mock.mock.restore();
  }
});

test("missing receipts, rejected tickets and transport errors remain retryable", async (t) => {
  for (const [body, checking, status] of [
    [{ data: {} }, true, 200],
    [{ data: { status: "ok" } }, false, 200],
    [
      { data: { status: "error", details: { error: "MessageRateExceeded" } } },
      false,
      200,
    ],
    [{}, false, 503],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () =>
      Response.json(body, { status }),
    );
    await assert.rejects(
      sendPush({ ...notification, receipt_id: "receipt" }, checking),
    );
    mock.mock.restore();
  }
});
