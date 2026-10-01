import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  chatgptLeaseStart,
  chatgptLeaseChallenge,
  chatgptLeaseFinish,
  chatgptExecutorLease,
  chatgptLeaseRenewal,
  chatgptCatalogPublication,
  chatgptLeaseHeartbeatMessage,
} from "@orbyn/core";
import { verifyChatgptExecutorProof } from "../src/modules/auth/chatgpt-executor-proof.js";

const binding = {
  user_id: randomUUID(),
  connection_id: randomUUID(),
  issuer: "https://auth.openai.com",
  subject: "fixture-subject",
  client_id: "fixture-issued-client",
};
const heartbeat = { executor_id: randomUUID(), lease_epoch: 1, sequence: 1 };
const signature = "A".repeat(86);

test("lease contracts reject credentials, arbitrary messages and client-selected ownership", () => {
  assert.ok(
    chatgptLeaseStart.safeParse({ executor_id: heartbeat.executor_id }).success,
  );
  assert.equal(
    chatgptLeaseStart.safeParse({
      executor_id: heartbeat.executor_id,
      user_id: binding.user_id,
    }).success,
    false,
  );
  assert.equal(
    chatgptLeaseFinish.safeParse({
      challenge_id: randomUUID(),
      signature,
      proof_message: "A".repeat(40),
    }).success,
    false,
  );
  assert.equal(
    chatgptLeaseRenewal.safeParse({
      heartbeat,
      signature,
      access_token: "secret",
    }).success,
    false,
  );
  assert.equal(
    chatgptLeaseRenewal.safeParse({
      heartbeat: { ...heartbeat, sequence: 0 },
      signature,
    }).success,
    false,
  );
  assert.equal(
    chatgptLeaseRenewal.safeParse({
      heartbeat: { ...heartbeat, lease_epoch: Number.MAX_SAFE_INTEGER + 1 },
      signature,
    }).success,
    false,
  );
});

test("lease metadata binds registration generation, account and server expiry", () => {
  const lease = {
    executor_id: heartbeat.executor_id,
    binding,
    enrollment_epoch: 1,
    lease_epoch: 1,
    expires_at: "2026-10-01T12:00:00.000Z",
  };
  assert.ok(chatgptExecutorLease.safeParse(lease).success);
  assert.equal(
    chatgptExecutorLease.safeParse({ ...lease, enrollment_epoch: 0 }).success,
    false,
  );
  assert.equal(
    chatgptExecutorLease.safeParse({ ...lease, expires_at: "tomorrow" })
      .success,
    false,
  );
  assert.ok(
    chatgptLeaseChallenge.safeParse({
      id: randomUUID(),
      executor_id: heartbeat.executor_id,
      binding,
      enrollment_epoch: 1,
      expected_lease_epoch: 0,
      proof_message: "A".repeat(40),
      expires_at: lease.expires_at,
    }).success,
  );
  assert.equal(
    chatgptCatalogPublication.safeParse({
      catalog: {
        executor_id: heartbeat.executor_id,
        binding,
        lease_epoch: 1,
        sequence: 1,
        models: [],
      },
      signature,
      endpoint: "https://example.com",
    }).success,
    false,
  );
});

test("heartbeat signatures cover canonical device, lease and monotonic sequence with a separate domain", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const message = chatgptLeaseHeartbeatMessage(heartbeat);
  assert.equal(
    message,
    chatgptLeaseHeartbeatMessage({
      sequence: 1,
      lease_epoch: 1,
      executor_id: heartbeat.executor_id,
    }),
  );
  const proof = sign(null, Buffer.from(message), privateKey).toString(
    "base64url",
  );
  assert.ok(verifyChatgptExecutorProof(key, message, proof));
  for (const changed of [
    { ...heartbeat, executor_id: randomUUID() },
    { ...heartbeat, lease_epoch: 2 },
    { ...heartbeat, sequence: 2 },
  ]) {
    assert.throws(() =>
      verifyChatgptExecutorProof(
        key,
        chatgptLeaseHeartbeatMessage(changed),
        proof,
      ),
    );
  }
  assert.throws(() =>
    verifyChatgptExecutorProof(
      key,
      message.replace("lease-heartbeat", "catalog"),
      proof,
    ),
  );
});
