import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  parseChatgptExecutorKey,
  verifyChatgptExecutorProof,
} from "../src/modules/auth/chatgpt-executor-proof.js";
const keys = generateKeyPairSync("ed25519");
const publicBytes = keys.publicKey.export({ type: "spki", format: "der" });
const encoded = publicBytes.toString("base64url");
const message = "orbyn:executor:enroll:v1:fixture-challenge-0123456789";
const signature = sign(null, Buffer.from(message), keys.privateKey).toString(
  "base64url",
);
const rejected = (error: unknown) =>
  error instanceof Error &&
  error.message === "The executor proof could not be verified.";

test("executor proof validates a real signature and returns only the public fingerprint", () => {
  const fingerprint = createHash("sha256")
    .update(publicBytes)
    .digest("base64url");
  assert.equal(parseChatgptExecutorKey(encoded).fingerprint, fingerprint);
  assert.equal(
    verifyChatgptExecutorProof(encoded, message, signature),
    fingerprint,
  );
});

test("other keys, changed challenge bytes and malformed signatures are rejected", () => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const alias =
    signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)!) + 1];
  assert.deepEqual(
    Buffer.from(alias, "base64url"),
    Buffer.from(signature, "base64url"),
  );
  const stranger = generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64url");
  for (const [key, text, proof] of [
    [stranger, message, signature],
    [encoded, message + "changed", signature],
    [encoded, message, signature.slice(0, -1)],
    [encoded, "short", signature],
    [encoded, "x".repeat(2049), signature],
    [encoded, message, "A".repeat(86)],
    [encoded, message, alias],
  ])
    assert.throws(() => verifyChatgptExecutorProof(key, text, proof), rejected);
});

test("private keys, noncanonical encodings and other key algorithms fail generically", () => {
  const privateKey = keys.privateKey
    .export({ type: "pkcs8", format: "der" })
    .toString("base64url");
  const ec = generateKeyPairSync("ec", { namedCurve: "secp256k1" })
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64url");
  const x25519 = generateKeyPairSync("x25519")
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64url");
  assert.equal(x25519.length, encoded.length);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(encoded.at(-1)!);
  const alias = encoded.slice(0, -1) + alphabet[last + 1];
  assert.equal(Buffer.from(alias, "base64url").equals(publicBytes), true);
  for (const value of [
    privateKey,
    ec,
    x25519,
    alias,
    encoded + "=",
    null,
    "A".repeat(59),
  ])
    assert.throws(() => parseChatgptExecutorKey(value), rejected);
});

test("native P-256 proofs bind canonical public key, exact message and fixed P1363 signature", () => {
  const native = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = native.publicKey.export({ type: "spki", format: "der" });
  const publicKey = der.toString("base64url");
  const proof = sign("sha256", Buffer.from(message), {
    key: native.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  assert.equal(publicKey.length, 122);
  assert.equal(proof.length, 86);
  assert.equal(
    verifyChatgptExecutorProof(publicKey, message, proof),
    createHash("sha256").update(der).digest("base64url"),
  );
  assert.throws(
    () => verifyChatgptExecutorProof(publicKey, message + "changed", proof),
    rejected,
  );
  const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .publicKey.export({ type: "spki", format: "der" })
    .toString("base64url");
  assert.throws(
    () => verifyChatgptExecutorProof(stranger, message, proof),
    rejected,
  );
  const derProof = sign(
    "sha256",
    Buffer.from(message),
    native.privateKey,
  ).toString("base64url");
  assert.throws(
    () => verifyChatgptExecutorProof(publicKey, message, derProof),
    rejected,
  );
  for (const curve of ["secp256k1", "secp384r1", "secp521r1"]) {
    const unsupported = generateKeyPairSync("ec", { namedCurve: curve })
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64url");
    assert.throws(() => parseChatgptExecutorKey(unsupported), rejected);
  }
  assert.throws(
    () =>
      parseChatgptExecutorKey(
        native.privateKey
          .export({ type: "pkcs8", format: "der" })
          .toString("base64url"),
      ),
    rejected,
  );
});
