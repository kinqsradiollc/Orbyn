import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createCipheriv } from "node:crypto";
// No SECRETS_KEY: the key is generated and kept in the (test) database.
process.env.SECRETS_KEY = "";
import "./setup.js";

const { encryptSecret, decryptSecret } = await import("../src/lib/secrets.js");
const { pool, closeDatabase } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
await migrate();

after(closeDatabase);

test("without SECRETS_KEY, keys are encrypted with a key kept in the database", async () => {
  const stored = await encryptSecret("sk-live-abcdefgh12345678");
  assert.ok(stored.startsWith("d1:"));
  assert.ok(!stored.includes("abcdefgh"));
  assert.equal(await decryptSecret(stored), "sk-live-abcdefgh12345678");
  const { rows } = await pool.query(
    "SELECT value FROM app_secrets WHERE name = 'credentials_key'",
  );
  assert.equal(rows.length, 1);
  assert.equal(Buffer.from(rows[0].value, "base64").length, 32);
  // The same key is reused, not regenerated.
  const again = await encryptSecret("second");
  assert.equal(await decryptSecret(again), "second");
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM app_secrets")).rows[0].n,
    1,
  );
});

test("a key saved with SECRETS_KEY asks for it back once it is removed", async () => {
  const cipher = createCipheriv(
    "aes-256-gcm",
    randomBytes(32),
    randomBytes(12),
  );
  const data = Buffer.concat([cipher.update("x"), cipher.final()]);
  const stored = [
    "v1",
    "bm9uY2U",
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":");
  await assert.rejects(() => decryptSecret(stored), /SECRETS_KEY/);
});
