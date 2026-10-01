import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  chatgptExecutorStart,
  chatgptExecutorChallenge,
  chatgptExecutorFinish,
  chatgptExecutorCatalog,
} from "../../packages/core/src/chatgpt-executors.js";
const binding = {
  user_id: randomUUID(),
  connection_id: randomUUID(),
  issuer: "https://auth.openai.com",
  subject: "fixture",
  client_id: "oaiapp_fixture",
};

test("executor contracts accept bounded public key and signed challenge fixtures", () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" });
  const start = {
    connection_id: binding.connection_id,
    host_id: randomUUID(),
    public_key: publicKey.toString("base64url"),
  };
  assert.deepEqual(chatgptExecutorStart.parse(start), start);
  const challenge = {
    id: randomUUID(),
    binding,
    host_id: start.host_id,
    public_key_fingerprint: createHash("sha256")
      .update(publicKey)
      .digest("base64url"),
    proof_message: "orbyn:executor:enroll:v1:" + randomUUID(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  assert.deepEqual(chatgptExecutorChallenge.parse(challenge), challenge);
  const finish = {
    challenge_id: challenge.id,
    signature: sign(
      null,
      Buffer.from(challenge.proof_message),
      keys.privateKey,
    ).toString("base64url"),
  };
  assert.deepEqual(chatgptExecutorFinish.parse(finish), finish);
  for (const extra of [
    { access_token: "fixture" },
    { refresh_token: "fixture" },
    { endpoint: "https://fixture.invalid" },
  ]) {
    assert.equal(
      chatgptExecutorStart.safeParse({ ...start, ...extra }).success,
      false,
    );
    assert.equal(
      chatgptExecutorFinish.safeParse({ ...finish, ...extra }).success,
      false,
    );
  }
});

test("catalog contracts reject credentials, duplicate models and stale sequence syntax", () => {
  const catalog = {
    executor_id: randomUUID(),
    binding,
    lease_epoch: 1,
    sequence: 1,
    models: [{ slug: "fixture-model", display_name: "Fixture" }],
  };
  assert.deepEqual(chatgptExecutorCatalog.parse(catalog), catalog);
  for (const over of [
    { sequence: 0 },
    { lease_epoch: -1 },
    { access_token: "fixture" },
    { models: [...catalog.models, ...catalog.models] },
    { models: [{ ...catalog.models[0], token: "fixture" }] },
  ])
    assert.equal(
      chatgptExecutorCatalog.safeParse({ ...catalog, ...over }).success,
      false,
    );
  assert.equal(
    chatgptExecutorCatalog.safeParse({
      ...catalog,
      binding: { ...binding, client_id: "dynamic_agent_client" },
    }).success,
    false,
  );
});
