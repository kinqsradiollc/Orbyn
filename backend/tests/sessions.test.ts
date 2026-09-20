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
