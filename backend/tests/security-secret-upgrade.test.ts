import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createCipheriv, randomUUID } from "node:crypto";
import "./setup.js";
import pg from "pg";

// Rewrapping visits every encrypted field and retires a database-wide key.
// Other suite files deliberately retire/recreate that key, so their remaining
// ciphertext cannot share this migration fixture's database.
const admin = new pg.Client({
  connectionString: process.env.TEST_DATABASE_URL,
});
await admin.connect();
const databaseName = `orbyn_secret_upgrade_${randomUUID().replaceAll("-", "")}_test`;
const databaseUrl = new URL(process.env.TEST_DATABASE_URL!);
databaseUrl.pathname = `/${databaseName}`;
let created = false;
let closeFixtureDatabase = async () => {};
after(async () => {
  try {
    await closeFixtureDatabase();
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});
await admin.query(`CREATE DATABASE "${databaseName}"`);
created = true;
await admin.query(
  `ALTER DATABASE "${databaseName}" SET orbyn.environment TO 'test'`,
);
process.env.DATABASE_URL = databaseUrl.href;
process.env.SECRETS_KEY = randomBytes(32).toString("base64");
const { pool, closeDatabase } = await import("../src/db/pool.js");
closeFixtureDatabase = closeDatabase;
const { migrate } = await import("../src/db/migrate.js");
const { rewrapLegacySecrets } = await import("../src/lib/rewrap-secrets.js");
const { decryptSecret } = await import("../src/lib/secrets.js");
await migrate();
test("upgrade rewraps legacy provider/SMTP secrets and retires the dump key", async () => {
  await pool.query(
    "INSERT INTO app_secrets(name,value) VALUES('credentials_key',$1) ON CONFLICT(name) DO NOTHING",
    [randomBytes(32).toString("base64")],
  );
  const key = Buffer.from(
    (
      await pool.query(
        "SELECT value FROM app_secrets WHERE name='credentials_key'",
      )
    ).rows[0].value,
    "base64",
  );
  const seal = (plain: string) => {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [
      "d1",
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":");
  };
  const id = randomUUID();
  await pool.query(
    "INSERT INTO ai_providers(id,kind,name,base_url,api_key_encrypted) VALUES($1,'custom','upgrade fixture','http://127.0.0.1:9',$2)",
    [id, seal("inert-provider-fixture")],
  );
  await pool.query(
    "INSERT INTO system_settings(key,value) VALUES('smtp',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [JSON.stringify({ password_encrypted: seal("inert-mail-fixture") })],
  );
  const userId = randomUUID(),
    jobId = randomUUID();
  await pool.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Upgrade fixture','inert')",
    [userId, `upgrade-${userId}@example.com`],
  );
  await pool.query("INSERT INTO ai_jobs(id,user_id,result) VALUES($1,$2,$3)", [
    jobId,
    userId,
    JSON.stringify({
      maintenance_output_encrypted: seal("inert-maintenance-fixture"),
    }),
  ]);
  const previousMode = process.env.NODE_ENV;
  const previousCutover = process.env.LEGACY_SECRET_CUTOVER;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.LEGACY_SECRET_CUTOVER;
    await assert.rejects(rewrapLegacySecrets(), /stopped legacy writers/);
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM app_secrets WHERE name='credentials_key'",
        )
      ).rowCount,
      1,
    );
    process.env.LEGACY_SECRET_CUTOVER = "quiesced";
    // SMTP is visited after the credential columns. A malformed later value
    // must roll back earlier conversion and retain the key for a safe retry.
    await pool.query("UPDATE system_settings SET value=$1 WHERE key='smtp'", [
      JSON.stringify({ password_encrypted: "d1:malformed" }),
    ]);
    await assert.rejects(rewrapLegacySecrets());
    assert.match(
      (
        await pool.query(
          "SELECT api_key_encrypted FROM ai_providers WHERE id=$1",
          [id],
        )
      ).rows[0].api_key_encrypted,
      /^d1:/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM app_secrets WHERE name='credentials_key'",
        )
      ).rowCount,
      1,
    );
    await pool.query("UPDATE system_settings SET value=$1 WHERE key='smtp'", [
      JSON.stringify({ password_encrypted: seal("inert-mail-fixture") }),
    ]);
    assert.ok((await rewrapLegacySecrets()) >= 3);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousCutover === undefined) delete process.env.LEGACY_SECRET_CUTOVER;
    else process.env.LEGACY_SECRET_CUTOVER = previousCutover;
  }
  const maintenance = (
    await pool.query("SELECT result FROM ai_jobs WHERE id=$1", [jobId])
  ).rows[0].result.maintenance_output_encrypted;
  assert.match(maintenance, /^v1:/);
  assert.equal(await decryptSecret(maintenance), "inert-maintenance-fixture");
  const stored = (
    await pool.query("SELECT api_key_encrypted FROM ai_providers WHERE id=$1", [
      id,
    ])
  ).rows[0].api_key_encrypted;
  assert.match(stored, /^v1:/);
  assert.equal(await decryptSecret(stored), "inert-provider-fixture");
  const smtp = (
    await pool.query("SELECT value FROM system_settings WHERE key='smtp'")
  ).rows[0].value.password_encrypted;
  assert.match(smtp, /^v1:/);
  assert.equal(await decryptSecret(smtp), "inert-mail-fixture");
  assert.equal(
    (await pool.query("SELECT 1 FROM app_secrets WHERE name='credentials_key'"))
      .rowCount,
    0,
  );
  assert.equal(await rewrapLegacySecrets(), 0, "upgrade is idempotent");
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [id]);
  await pool.query("DELETE FROM system_settings WHERE key='smtp'");
});
