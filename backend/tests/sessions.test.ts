import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const email = `sess-${randomUUID()}@example.com`;
const password = "a-long-test-password";

/** Sign in from a named device and return its bearer token. */
async function signIn(ua: string) {
  const r = await app.inject({
    method: "POST",
    url: "/auth/login",
    headers: { "user-agent": ua },
    payload: { email, password },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().token as string;
}
const get = (url: string, token: string) =>
  app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
  });

before(async () => {
  await migrate();
  await app.inject({
    method: "POST",
    url: "/auth/register",
    headers: { "user-agent": "Phone" },
    payload: { email, password, name: "S" },
  });
});
after(async () => {
  await app.close();
  await pool.end();
});

test("sessions list shows each device and flags the current one", async () => {
  const laptop = await signIn("Laptop");
  const phone = await signIn("Phone");

  const list = (await get("/me/sessions", phone)).json();
  assert.ok(list.length >= 2);
  const current = list.filter((s: { current: boolean }) => s.current);
  assert.equal(current.length, 1, "exactly one current session");
  assert.equal(current[0].user_agent, "Phone");
  assert.ok(
    list.some((s: { user_agent: string }) => s.user_agent === "Laptop"),
  );
});

test("you can sign out another device but not the current one", async () => {
  const laptop = await signIn("Laptop2");
  const phone = await signIn("Phone2");
  const list = (await get("/me/sessions", phone)).json();
  const laptopRow = list.find(
    (s: { user_agent: string }) => s.user_agent === "Laptop2",
  );
  const phoneRow = list.find((s: { current: boolean }) => s.current);

  // Signing out the current session this way is refused (use logout).
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/me/sessions/${phoneRow.id}`,
        headers: { authorization: `Bearer ${phone}` },
      })
    ).statusCode,
    404,
  );
  // Signing out the other device works, and that token stops working.
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/me/sessions/${laptopRow.id}`,
        headers: { authorization: `Bearer ${phone}` },
      })
    ).statusCode,
    204,
  );
  assert.equal((await get("/me", laptop)).statusCode, 401);
  assert.equal((await get("/me", phone)).statusCode, 200);
});

test("sign out everywhere else keeps only the current session", async () => {
  await signIn("A");
  await signIn("B");
  const here = await signIn("Here");

  const revoked = await app.inject({
    method: "POST",
    url: "/me/sessions/revoke-others",
    headers: { authorization: `Bearer ${here}` },
  });
  assert.equal(revoked.statusCode, 200);
  assert.ok(revoked.json().signed_out >= 2);

  const list = (await get("/me/sessions", here)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].current, true);
});

test("using the app keeps a session alive; an idle one still expires", async () => {
  const token = await signIn("Busy");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("hex");
  // Signed in 29 days ago and last seen a while back: about to expire.
  await pool.query(
    `UPDATE sessions SET expires_at = now() + interval '1 day',
            last_seen_at = now() - interval '1 hour' WHERE token_hash = $1`,
    [hash],
  );
  assert.equal((await get("/me", token)).statusCode, 200);
  const { rows } = await pool.query<{ days: number }>(
    "SELECT extract(epoch FROM expires_at - now()) / 86400 AS days FROM sessions WHERE token_hash = $1",
    [hash],
  );
  assert.ok(rows[0].days > 29, `expected ~30 days left, got ${rows[0].days}`);

  // Past its expiry, using it doesn't bring it back.
  await pool.query(
    "UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
    [hash],
  );
  assert.equal((await get("/me", token)).statusCode, 401);
});

test("new sessions have a namespace distinct from API and agent credentials", async () => {
  const token = await signIn("Namespaced session");
  assert.match(token, /^os_[A-Za-z0-9_-]{64}$/);
  assert.equal((await get("/me", token)).statusCode, 200);
  assert.equal((await get("/me", "ok_not-a-real-api-key")).statusCode, 401);
  assert.equal((await get("/me", "oak_not-a-real-agent-key")).statusCode, 401);
});

test("existing unprefixed session tokens remain usable", async () => {
  const { digest } = await import("../src/lib/auth.js");
  const token = await signIn("Legacy session");
  const legacy = `legacy-${randomUUID()}`;
  await pool.query(
    "UPDATE sessions SET token_hash = $1 WHERE token_hash = $2",
    [digest(legacy), digest(token)],
  );
  assert.equal((await get("/me", legacy)).statusCode, 200);
  assert.equal((await get("/me", token)).statusCode, 401);
});
