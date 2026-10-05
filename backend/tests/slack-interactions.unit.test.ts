import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  readSlackReply,
  resolveSlackReply,
  SlackInteractionError,
  type SlackDeliveryBinding,
} from "../src/modules/agent-channels/slack-interactions.js";
const secret = "fixture-signing-secret",
  now = Date.parse("2026-10-05T10:00:00Z"),
  timestamp = String(now / 1000);
const delivery: SlackDeliveryBinding = {
  id: randomUUID(),
  waitingId: randomUUID(),
  appId: "A123",
  workspaceId: "T123",
  userId: "U123",
  channelId: "D123",
  messageTs: "1000.000001",
  kind: "approval",
  connectionRevision: 1,
  expiresAt: new Date(now + 60000),
};
const connection = { revision: 1, revoked: false };
const input = () => ({
  type: "block_actions",
  api_app_id: delivery.appId,
  team: { id: delivery.workspaceId },
  user: { id: delivery.userId },
  channel: { id: delivery.channelId },
  container: { type: "message", message_ts: delivery.messageTs },
  actions: [
    {
      type: "button",
      action_id: "orbyn.approve",
      value: delivery.id,
      action_ts: "1001.000001",
    },
  ],
});
function signed(value: unknown = input(), at = timestamp) {
  const raw = Buffer.from(
    new URLSearchParams({ payload: JSON.stringify(value) }).toString(),
  );
  const headers = {
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    "x-slack-request-timestamp": at,
    "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${at}:`).update(raw).digest("hex")}`,
  };
  return { raw, headers };
}
const refusal = (status: number) => (error: unknown) =>
  error instanceof SlackInteractionError && error.status === status;
const read = (value: unknown = input()) => {
  const s = signed(value);
  return readSlackReply(s.raw, s.headers, secret, delivery.appId, now);
};
test("Slack raw-byte signature authenticates an actor without borrowing backend credentials", () => {
  const reply = read();
  assert.deepEqual(
    resolveSlackReply(
      reply,
      delivery,
      { id: delivery.waitingId, kind: "approval" },
      connection,
      now,
    ),
    { waiting_id: delivery.waitingId, approved: true, scope: "once" },
  );
  assert.equal(reply.requestDigest.length, 64);
  assert.equal(
    read().requestDigest,
    reply.requestDigest,
    "retries have one stable receipt key",
  );
});
test("tampered body, malformed/duplicate headers, absent secrets and expired timestamps reject", () => {
  const s = signed();
  assert.throws(
    () =>
      readSlackReply(
        Buffer.concat([s.raw, Buffer.from(" ")]),
        s.headers,
        secret,
        delivery.appId,
        now,
      ),
    refusal(401),
  );
  for (const headers of [
    { ...s.headers, "x-slack-signature": [s.headers["x-slack-signature"]] },
    { ...s.headers, "x-slack-request-timestamp": "bad" },
    { ...s.headers, "x-slack-signature": "v0=no" },
  ])
    assert.throws(
      () => readSlackReply(s.raw, headers, secret, delivery.appId, now),
      refusal(401),
    );
  assert.throws(
    () => readSlackReply(s.raw, s.headers, "", delivery.appId, now),
    refusal(401),
  );
  assert.throws(
    () =>
      readSlackReply(s.raw, s.headers, secret, delivery.appId, now + 301000),
    refusal(401),
  );
});
test("wrong app, channel type, multiple actions and forged delivery identifiers reject", () => {
  assert.throws(() => read({ ...input(), api_app_id: "A999" }), refusal(403));
  assert.throws(
    () => read({ ...input(), channel: { id: "C123" } }),
    refusal(400),
  );
  assert.throws(
    () =>
      read({ ...input(), actions: [...input().actions, ...input().actions] }),
    refusal(400),
  );
  assert.throws(
    () =>
      read({
        ...input(),
        actions: [{ ...input().actions[0], value: "not-an-id" }],
      }),
    refusal(400),
  );
});
test("signed Slack actor cannot answer another owner, workspace, message or connection revision", () => {
  const reply = read(),
    current = { id: delivery.waitingId, kind: "approval" as const };
  for (const changed of [
    { userId: "U999" },
    { workspaceId: "T999" },
    { channelId: "D999" },
    { messageTs: "1000.000002" },
    { id: randomUUID() },
    { expiresAt: new Date(now - 1) },
  ])
    assert.throws(
      () =>
        resolveSlackReply(
          reply,
          { ...delivery, ...changed },
          current,
          connection,
          now,
        ),
      refusal(403),
    );
  assert.throws(
    () =>
      resolveSlackReply(
        reply,
        delivery,
        current,
        { revision: 2, revoked: false },
        now,
      ),
    refusal(403),
  );
  assert.throws(
    () =>
      resolveSlackReply(
        reply,
        delivery,
        current,
        { revision: 1, revoked: true },
        now,
      ),
    refusal(403),
  );
});
test("stale card never approves the next prompt or an already answered job", () => {
  const reply = read();
  assert.throws(
    () =>
      resolveSlackReply(
        reply,
        delivery,
        { id: randomUUID(), kind: "approval" },
        connection,
        now,
      ),
    refusal(409),
  );
  assert.throws(
    () => resolveSlackReply(reply, delivery, null, connection, now),
    refusal(409),
  );
  assert.throws(
    () =>
      resolveSlackReply(
        reply,
        delivery,
        { id: delivery.waitingId, kind: "question" },
        connection,
        now,
      ),
    refusal(409),
  );
});
test("questions use the current displayed choices or bounded submitted text", () => {
  const binding = { ...delivery, kind: "question" as const },
    current = {
      id: delivery.waitingId,
      kind: "question" as const,
      choices: ["First", "Second"],
    };
  const choice = read({
    ...input(),
    actions: [{ ...input().actions[0], action_id: "orbyn.choice.1" }],
  });
  assert.deepEqual(
    resolveSlackReply(choice, binding, current, connection, now),
    { waiting_id: delivery.waitingId, answer: "Second" },
  );
  const text = read({
    ...input(),
    actions: [{ ...input().actions[0], action_id: "orbyn.submit" }],
    state: {
      values: {
        [`orbyn-${delivery.id}`]: {
          "orbyn.answer": {
            type: "plain_text_input",
            value: " A different answer ",
          },
        },
      },
    },
  });
  assert.deepEqual(resolveSlackReply(text, binding, current, connection, now), {
    waiting_id: delivery.waitingId,
    answer: "A different answer",
  });
  assert.throws(
    () =>
      resolveSlackReply(
        choice,
        binding,
        { ...current, choices: [] },
        connection,
        now,
      ),
    refusal(400),
  );
  assert.throws(
    () =>
      read({
        ...input(),
        actions: [{ ...input().actions[0], action_id: "orbyn.submit" }],
      }),
    refusal(400),
  );
});
test("payload bytes are bounded before parsing and unsupported content types reject", () => {
  const s = signed();
  assert.throws(
    () =>
      readSlackReply(
        Buffer.alloc(65537),
        s.headers,
        secret,
        delivery.appId,
        now,
      ),
    refusal(413),
  );
  assert.throws(
    () =>
      readSlackReply(
        s.raw,
        { ...s.headers, "content-type": "application/json" },
        secret,
        delivery.appId,
        now,
      ),
    refusal(400),
  );
});
