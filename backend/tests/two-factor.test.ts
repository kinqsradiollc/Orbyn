import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const totp = await import("../src/lib/totp.js");

const app = await buildApp();
const email = `tfa-${randomUUID()}@example.com`;
const password = "a-long-test-password";
let token = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (
  method: "GET" | "POST",
  url: string,
  payload?: unknown,
  headers = auth(),
) =>
  app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const login = (body: object) =>
  app.inject({ method: "POST", url: "/auth/login", payload: body });

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password, name: "T" },
  });
  token = reg.json().token;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("a generated code verifies, a wrong one doesn't, and base32 round-trips", () => {
  const secret = totp.generateSecret();
  assert.equal(totp.base32Decode(secret).length, 20, "20-byte secret");
  assert.ok(totp.verifyTotp(secret, liveCode(secret)), "the live code passes");
  assert.equal(totp.verifyTotp(secret, "000000"), false, "a wrong code fails");
  // base32 encode/decode is a faithful round-trip.
  const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 64, 32]);
  assert.deepEqual(totp.base32Decode(totp.base32Encode(bytes)), bytes);
});

test("setup, enable, and then login requires a code", async () => {
  const setup = (await call("POST", "/me/2fa/setup")).json();
  assert.ok(setup.secret && setup.otpauth_uri.startsWith("otpauth://totp/"));
  assert.equal((await call("GET", "/me/2fa")).json().enabled, false);

  // A wrong code is refused.
  assert.equal(
    (await call("POST", "/me/2fa/enable", { code: "000000" })).statusCode,
    422,
  );

  // The right code enables it and returns recovery codes.
  const code = liveCode(setup.secret);
  const enabled = await call("POST", "/me/2fa/enable", { code });
  assert.equal(enabled.statusCode, 200, enabled.body);
  const recovery: string[] = enabled.json().recovery_codes;
  assert.equal(recovery.length, 10);
  assert.equal((await call("GET", "/me/2fa")).json().enabled, true);

  // Login without a code now asks for one.
  const noCode = await login({ email, password });
  assert.equal(noCode.statusCode, 401);
  assert.equal(noCode.json().message, "totp_required");

  // A wrong code is refused with a different message.
  const wrong = await login({ email, password, code: "123456" });
  assert.equal(wrong.statusCode, 401);
  assert.match(wrong.json().message, /didn't work/);

  // The live code signs in.
  const ok = await login({ email, password, code: liveCode(setup.secret) });
  assert.equal(ok.statusCode, 200, ok.body);

  // A recovery code also signs in, and is then spent (single-use).
  const rec = recovery[0];
  assert.equal((await login({ email, password, code: rec })).statusCode, 200);
  assert.equal((await login({ email, password, code: rec })).statusCode, 401);

  // Disabling needs the password and turns it off.
  assert.equal(
    (await call("POST", "/me/2fa/disable", { password: "wrong" })).statusCode,
    403,
  );
  assert.equal(
    (await call("POST", "/me/2fa/disable", { password })).statusCode,
    204,
  );
  assert.equal(
    (await login({ email, password })).statusCode,
    200,
    "no code needed once off",
  );
});

/** A code valid right now for a base32 secret. */
function liveCode(secret: string): string {
  // Mirror the server: HMAC-SHA1 over the 30s counter, dynamic truncation.
  const key = totp.base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}
