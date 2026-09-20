import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const email = `pk-${randomUUID()}@example.com`;
const password = "a-long-test-password";
let token = "";
let userId = "";
const auth = () => ({ authorization: `Bearer ${token}` });
const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, headers = auth()) =>
  app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password, name: "PK" },
  });
  token = reg.json().token;
  userId = reg.json().user.id;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("registration options are issued and a challenge is stored", async () => {
  assert.deepEqual((await call("GET", "/me/passkeys")).json(), []);
  const r = await call("POST", "/me/passkeys/options");
  assert.equal(r.statusCode, 200, r.body);
  const opts = r.json();
  assert.ok(opts.challenge, "a challenge is returned");
  assert.equal(opts.rp.id, "localhost", "rp id from APP_URL host");
  const stored = await pool.query(
    "SELECT 1 FROM webauthn_challenges WHERE handle = $1",
    [userId],
  );
  assert.equal(stored.rowCount, 1);
});

test("an unverifiable registration response is rejected", async () => {
  await call("POST", "/me/passkeys/options");
  const r = await call("POST", "/me/passkeys", {
    response: { id: "bogus", rawId: "bogus", type: "public-key", response: {} },
    name: "Fake",
  });
  assert.equal(r.statusCode, 400);
});

test("passkeys list and delete (seeded directly)", async () => {
  await pool.query(
    `INSERT INTO webauthn_credentials (id, user_id, public_key, counter, name)
       VALUES ($1, $2, $3, 0, 'My Phone')`,
    [`cred-${randomUUID()}`, userId, Buffer.from([1, 2, 3])],
  );
  const list = (await call("GET", "/me/passkeys")).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "My Phone");
  assert.equal((await call("DELETE", `/me/passkeys/${list[0].id}`)).statusCode, 204);
  assert.equal((await call("GET", "/me/passkeys")).json().length, 0);
});

test("sign-in options return a handle; a bad handle is refused", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/auth/passkey/options",
    payload: { email },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().handle, "an opaque handle is returned");
  assert.ok(r.json().options.challenge);

  const bad = await app.inject({
    method: "POST",
    url: "/auth/passkey",
    payload: {
      handle: "nope",
      response: { id: "x", rawId: "x", type: "public-key", response: {} },
    },
  });
  assert.equal(bad.statusCode, 401);
});

test("password sign-in is unaffected by passkeys", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(r.json().token);
});
