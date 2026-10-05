import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readSlackEvent } from "../src/modules/agent-channels/slack-events.js";
import { SlackInteractionError } from "../src/modules/agent-channels/slack-interactions.js";
const secret = "fixture-signing-secret";
const now = Date.parse("2026-10-06T10:00:00Z");
const timestamp = String(now / 1000);
const input = () => ({
  type: "event_callback",
  api_app_id: "A123",
  team_id: "T123",
  event_id: "Ev123",
  event: {
    type: "message",
    channel_type: "im",
    channel: "D123",
    user: "U123",
    text: " First source ",
    ts: "1001.000001",
    thread_ts: "1000.000001",
  },
});
const signed = (value: unknown = input(), at = timestamp) => {
  const raw = Buffer.from(JSON.stringify(value));
  return {
    raw,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-slack-request-timestamp": at,
      "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${at}:`).update(raw).digest("hex")}`,
    },
  };
};
const read = (value: unknown = input()) => {
  const s = signed(value);
  return readSlackEvent(s.raw, s.headers, secret, "A123", now);
};
const refusal = (status: number) => (e: unknown) =>
  e instanceof SlackInteractionError && e.status === status;

test("signed human DM thread supplies exact sent-message identity and bounded normalized text", () => {
  const result = read();
  assert.equal(result.kind, "reply");
  if (result.kind !== "reply") throw new Error("reply missing");
  assert.equal(result.reply.messageTs, "1000.000001");
  assert.equal(result.reply.actionTs, "1001.000001");
  assert.equal(result.reply.answer, "First source");
  assert.equal(result.reply.userId, "U123");
  assert.equal(result.reply.workspaceId, "T123");
  assert.equal(result.reply.requestDigest.length, 64);
  assert.deepEqual(read(), result);
  assert.equal(
    "deliveryId" in result.reply,
    false,
    "delivery must be resolved from an owned committed card",
  );
});
test("invalid HMAC, stale time and duplicate signature headers reject before malformed JSON is decoded", () => {
  const s = signed();
  assert.throws(
    () => readSlackEvent(Buffer.from("{"), s.headers, secret, "A123", now),
    refusal(401),
  );
  assert.throws(
    () =>
      readSlackEvent(
        s.raw,
        { ...s.headers, "x-slack-signature": [s.headers["x-slack-signature"]] },
        secret,
        "A123",
        now,
      ),
    refusal(401),
  );
  const expired = signed(input(), String(now / 1000 - 301));
  assert.throws(
    () => readSlackEvent(expired.raw, expired.headers, secret, "A123", now),
    refusal(401),
  );
  const future = signed(input(), String(now / 1000 + 301));
  assert.throws(
    () => readSlackEvent(future.raw, future.headers, secret, "A123", now),
    refusal(401),
  );
  assert.throws(
    () => readSlackEvent(s.raw, s.headers, "", "A123", now),
    refusal(401),
  );
});
test("signed URL challenge requires the app secret; legacy token cannot authorize it", () => {
  assert.deepEqual(
    read({
      type: "url_verification",
      challenge: "challenge",
      token: "ignored",
    }),
    { kind: "challenge", challenge: "challenge" },
  );
  const s = signed({
    type: "url_verification",
    challenge: "challenge",
    token: secret,
  });
  assert.throws(
    () =>
      readSlackEvent(
        s.raw,
        { "content-type": "application/json" },
        secret,
        "A123",
        now,
      ),
    refusal(401),
  );
  assert.throws(
    () => read({ type: "url_verification", challenge: "x".repeat(513) }),
    refusal(400),
  );
});
test("wrong app, malformed envelope and oversized answers refuse", () => {
  assert.throws(() => read({ ...input(), api_app_id: "A999" }), refusal(403));
  assert.throws(() => read({ ...input(), team_id: "C123" }), refusal(400));
  assert.throws(
    () =>
      read({ ...input(), event: { ...input().event, text: "x".repeat(4001) } }),
    refusal(400),
  );
  assert.throws(
    () => read({ ...input(), event: { ...input().event, text: " " } }),
    refusal(400),
  );
  assert.throws(
    () => read({ ...input(), event: { ...input().event, user: "B123" } }),
    refusal(400),
  );
});
test("bots, edits, deletions, top-level DMs and other channel types never become replies", () => {
  for (const event of [
    { ...input().event, subtype: "message_changed", message: input().event },
    { ...input().event, subtype: "message_deleted" },
    { ...input().event, bot_id: "B123" },
    { ...input().event, bot_profile: {} },
    { ...input().event, channel_type: "channel" },
    { ...input().event, type: "reaction_added" },
    { ...input().event, thread_ts: undefined },
    { ...input().event, thread_ts: input().event.ts },
  ])
    assert.deepEqual(read({ ...input(), event }), { kind: "ignored" });
});
test("signed body remains bounded with strict content type and UTF-8 decoding", () => {
  const s = signed();
  assert.throws(
    () => readSlackEvent(Buffer.alloc(65537), s.headers, secret, "A123", now),
    refusal(413),
  );
  assert.throws(
    () =>
      readSlackEvent(
        s.raw,
        { ...s.headers, "content-type": "application/x-www-form-urlencoded" },
        secret,
        "A123",
        now,
      ),
    refusal(400),
  );
  const raw = Buffer.from([0xff]);
  const headers = {
    ...s.headers,
    "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(raw).digest("hex")}`,
  };
  assert.throws(
    () => readSlackEvent(raw, headers, secret, "A123", now),
    refusal(400),
  );
});
