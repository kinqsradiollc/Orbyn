import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import {
  chatgptInferencePublication,
  chatgptInferenceReceiptMessage,
} from "@orbyn/core";
import {
  chatgptInferenceProofMessage,
  verifyChatgptExecutorProof,
} from "../src/modules/auth/chatgpt-executor-proof.js";

const receipt = (text: string) => ({
  request_id: randomUUID(),
  executor_id: randomUUID(),
  binding: {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  },
  enrollment_epoch: 1,
  lease_epoch: 1,
  model: "fixture-model",
  nonce: "n".repeat(43),
  request_hash: "a".repeat(64),
  result: { status: "completed", text, usage: null },
});
test("v2 receipt proofs verify maximum-size results using Ed25519 and native P-256", () => {
  const result = receipt("x".repeat(1_000_000));
  const message = chatgptInferenceProofMessage(result, "sha256_v2");
  assert.ok(Buffer.byteLength(message) < 128);
  for (const native of [false, true]) {
    const keys = native
      ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      : generateKeyPairSync("ed25519");
    const key = keys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64url");
    const signature = sign(
      native ? "sha256" : null,
      Buffer.from(message),
      native
        ? { key: keys.privateKey, dsaEncoding: "ieee-p1363" }
        : keys.privateKey,
    ).toString("base64url");
    assert.match(
      verifyChatgptExecutorProof(key, message, signature),
      /^[A-Za-z0-9_-]{43}$/,
    );
    for (const changed of [
      { ...result, request_id: randomUUID() },
      { ...result, executor_id: randomUUID() },
      { ...result, binding: { ...result.binding, subject: "different" } },
      { ...result, enrollment_epoch: 2 },
      { ...result, lease_epoch: 2 },
      { ...result, model: "different-model" },
      { ...result, nonce: "q".repeat(43) },
      { ...result, request_hash: "b".repeat(64) },
      { ...result, result: { ...result.result, text: "changed" } },
      {
        ...result,
        result: {
          ...result.result,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ])
      assert.throws(
        () =>
          verifyChatgptExecutorProof(
            key,
            chatgptInferenceProofMessage(changed, "sha256_v2"),
            signature,
          ),
        /could not be verified/,
      );
    assert.throws(
      () =>
        verifyChatgptExecutorProof(
          key,
          chatgptInferenceReceiptMessage(result),
          signature,
        ),
      /could not be verified/,
    );
  }
});
test("legacy proofs stay exact and unknown or removed format cannot downgrade v2 signatures", () => {
  const result = receipt("small");
  assert.equal(
    chatgptInferenceProofMessage(result),
    chatgptInferenceReceiptMessage(result),
  );
  const keys = generateKeyPairSync("ed25519");
  const key = keys.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const signature = sign(
    null,
    Buffer.from(chatgptInferenceProofMessage(result)),
    keys.privateKey,
  ).toString("base64url");
  assert.match(
    verifyChatgptExecutorProof(
      key,
      chatgptInferenceProofMessage(result),
      signature,
    ),
    /^[A-Za-z0-9_-]{43}$/,
  );
  assert.throws(() =>
    verifyChatgptExecutorProof(
      key,
      chatgptInferenceProofMessage(result, "sha256_v2"),
      signature,
    ),
  );
  assert.throws(() =>
    chatgptInferencePublication.parse({
      receipt: result,
      signature,
      proof_format: "unknown",
    }),
  );
  assert.throws(() => chatgptInferenceProofMessage(result, "unknown" as never));
});
