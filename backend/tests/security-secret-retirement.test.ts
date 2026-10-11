import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createCipheriv } from "node:crypto";
import "./setup.js";
process.env.SECRETS_KEY = randomBytes(32).toString("base64");
const { pool, closeDatabase } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { decryptSecret, encryptSecret } = await import("../src/lib/secrets.js");
await migrate();
after(closeDatabase);

test("missing retired key cannot be recreated by legacy decryption; local creation still works", async () => {
  await pool.query("DELETE FROM app_secrets WHERE name='credentials_key'");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", randomBytes(32), nonce);
  const data = Buffer.concat([
    cipher.update("inert orphan ciphertext"),
    cipher.final(),
  ]);
  const orphan = [
    "d1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":");
  const previousMode = process.env.NODE_ENV;
  const previousKey = env.SECRETS_KEY;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(
      decryptSecret(orphan),
      /Legacy credential key is missing/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM app_secrets WHERE name='credentials_key'",
        )
      ).rowCount,
      0,
    );
    process.env.NODE_ENV = "development";
    env.SECRETS_KEY = "";
    const legitimate = await encryptSecret("inert local credential");
    assert.match(legitimate, /^d1:/);
    assert.equal(await decryptSecret(legitimate), "inert local credential");
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM app_secrets WHERE name='credentials_key'",
        )
      ).rowCount,
      1,
    );
  } finally {
    env.SECRETS_KEY = previousKey;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    await pool.query("DELETE FROM app_secrets WHERE name='credentials_key'");
  }
});
