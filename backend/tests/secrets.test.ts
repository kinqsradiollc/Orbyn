import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
process.env.SECRETS_KEY = randomBytes(32).toString("base64");
const { decryptSecret, encryptSecret, maskSecret } =
  await import("../src/lib/secrets.js");

test("secrets round-trip and never store the plain value", async () => {
  const plain = "sk-test-1234567890abcdef";
  const stored = await encryptSecret(plain);
  assert.ok(!stored.includes(plain));
  assert.notEqual(
    stored,
    await encryptSecret(plain),
    "each value uses a fresh nonce",
  );
  assert.equal(await decryptSecret(stored), plain);
});

test("tampered ciphertext is rejected", async () => {
  const parts = (await encryptSecret("sk-live-abcdefgh12345678")).split(":");
  const data = Buffer.from(parts[3], "base64url");
  data[0] ^= 1;
  parts[3] = data.toString("base64url");
  await assert.rejects(() => decryptSecret(parts.join(":")));
});

test("masking shows only a short prefix and the last four characters", () => {
  assert.equal(maskSecret("sk-ant-api03-verysecretvalue9f2a"), "sk-…9f2a");
  assert.equal(maskSecret("short"), "••••");
  assert.equal(maskSecret(""), "");
});
