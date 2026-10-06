import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { chatgptCatalogSigningInput } from "@orbyn/core";
import {
  chatgptCatalogProofMessage,
  verifyChatgptCatalogProof,
} from "../src/modules/auth/chatgpt-executor-proof.js";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64url");
const catalog = {
  executor_id: randomUUID(),
  binding: {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "catalog-fixture",
    client_id: "oaiapp_catalog_fixture",
  },
  lease_epoch: 2,
  sequence: 3,
  models: [{ slug: "fixture-model", display_name: "Fixture model" }],
};
const message = chatgptCatalogProofMessage(catalog);
const signature = sign(null, Buffer.from(message), keys.privateKey).toString(
  "base64url",
);
test("catalog signatures use a canonical, bounded digest independent of object property order", () => {
  const reordered = {
    models: catalog.models,
    sequence: 3,
    lease_epoch: 2,
    binding: catalog.binding,
    executor_id: catalog.executor_id,
  };
  assert.equal(
    chatgptCatalogSigningInput(reordered),
    chatgptCatalogSigningInput(catalog),
  );
  assert.equal(chatgptCatalogProofMessage(reordered), message);
  assert.match(
    verifyChatgptCatalogProof(publicKey, reordered, signature),
    /^[A-Za-z0-9_-]{43}$/,
  );
  const large = {
    ...catalog,
    models: Array.from({ length: 1000 }, (_, i) => ({
      slug: `fixture-${i}`,
      display_name: "Large catalog fixture".repeat(8),
    })),
  };
  assert.ok(chatgptCatalogSigningInput(large).length > 100000);
  assert.equal(chatgptCatalogProofMessage(large).length, message.length);
  const largeSignature = sign(
    null,
    Buffer.from(chatgptCatalogProofMessage(large)),
    keys.privateKey,
  ).toString("base64url");
  assert.match(
    verifyChatgptCatalogProof(publicKey, large, largeSignature),
    /^[A-Za-z0-9_-]{43}$/,
  );
});
test("catalog signatures bind account, executor, lease, sequence and every model field", () => {
  for (const changed of [
    { ...catalog, executor_id: randomUUID() },
    { ...catalog, binding: { ...catalog.binding, user_id: randomUUID() } },
    {
      ...catalog,
      binding: { ...catalog.binding, connection_id: randomUUID() },
    },
    { ...catalog, binding: { ...catalog.binding, subject: "other-account" } },
    {
      ...catalog,
      binding: { ...catalog.binding, client_id: "oaiapp_other_fixture" },
    },
    { ...catalog, lease_epoch: 1 },
    { ...catalog, sequence: 4 },
    { ...catalog, models: [] },
    {
      ...catalog,
      models: [{ slug: "other-model", display_name: "Fixture model" }],
    },
    {
      ...catalog,
      models: [{ slug: "fixture-model", display_name: "Other name" }],
    },
    { ...catalog, access_token: "never-accepted" },
  ])
    assert.throws(
      () => verifyChatgptCatalogProof(publicKey, changed, signature),
      /executor proof could not be verified/,
    );
  const enrollmentSignature = sign(
    null,
    Buffer.from("orbyn:executor:enroll:v1:unrelated-fixture"),
    keys.privateKey,
  ).toString("base64url");
  assert.throws(
    () => verifyChatgptCatalogProof(publicKey, catalog, enrollmentSignature),
    /executor proof could not be verified/,
  );
  const ordered = {
    ...catalog,
    models: [
      ...catalog.models,
      { slug: "second-fixture", display_name: "Second" },
    ],
  };
  const orderedSignature = sign(
    null,
    Buffer.from(chatgptCatalogProofMessage(ordered)),
    keys.privateKey,
  ).toString("base64url");
  assert.throws(
    () =>
      verifyChatgptCatalogProof(
        publicKey,
        { ...ordered, models: [...ordered.models].reverse() },
        orderedSignature,
      ),
    /executor proof could not be verified/,
  );
});

test("native P-256 catalog signatures retain account, lease and sequence fencing", () => {
  const native = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = native.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const signature = sign("sha256", Buffer.from(message), {
    key: native.privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  assert.match(
    verifyChatgptCatalogProof(publicKey, catalog, signature),
    /^[A-Za-z0-9_-]{43}$/,
  );
  for (const changed of [
    { ...catalog, sequence: catalog.sequence + 1 },
    { ...catalog, lease_epoch: catalog.lease_epoch + 1 },
    { ...catalog, binding: { ...catalog.binding, subject: "another-account" } },
    {
      ...catalog,
      models: [{ slug: "another-model", display_name: "Other model" }],
    },
  ])
    assert.throws(
      () => verifyChatgptCatalogProof(publicKey, changed, signature),
      /could not be verified/,
    );
});
