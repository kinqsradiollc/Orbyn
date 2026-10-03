import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { UserRow } from "../src/lib/auth.js";
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
await migrate();
const { buildApp } = await import("../src/app.js");
const { settings } = await import("../src/lib/settings.js");
const { issueSession, digest, appSessionLimitKey } =
  await import("../src/lib/auth.js");
const app = await buildApp();
let user: UserRow;
let first: string;
let second: string;
let oldLimit: number;
const call = (
  token: string | undefined,
  ip = "10.245.1.1",
  url = "/me",
  method: "GET" | "POST" = "GET",
  payload?: object,
) =>
  app.inject({
    method,
    url,
    remoteAddress: ip,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
before(async () => {
  const account = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: "10.245.99.1",
    payload: {
      email: `session-limits-${randomUUID()}@orbyn.test`,
      name: "Device limits",
      password: "long-test-password",
    },
  });
  assert.equal(account.statusCode, 201, account.body);
  user = (
    await pool.query("SELECT * FROM users WHERE id=$1", [
      account.json().user.id,
    ])
  ).rows[0];
  first = account.json().token;
  second = (await issueSession(user, "second device")).token;
  const live = await settings();
  oldLimit = live.rate_limit_per_minute;
  live.rate_limit_per_minute = 2;
});
after(async () => {
  (await settings()).rate_limit_per_minute = oldLimit;
  await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  await app.close();
  await pool.end();
});
test("live device sessions have independent global allowances on a shared IP and keep them after IP changes", async () => {
  assert.equal((await call(first)).statusCode, 200);
  assert.equal((await call(first)).statusCode, 200);
  const held = await call(first, "10.245.1.2");
  assert.equal(held.statusCode, 429);
  assert.ok(Number(held.headers["retry-after"]) > 0);
  const other = await call(second);
  assert.equal(other.statusCode, 200);
  assert.equal(Number(other.headers["ratelimit-remaining"]), 1);
});
test("forged sessions share the anonymous IP bucket and cannot drain a real session", async () => {
  const live = (await issueSession(user, "valid third device")).token;
  assert.equal((await call("os_forged-a", "10.245.2.1")).statusCode, 401);
  assert.equal((await call("os_forged-b", "10.245.2.1")).statusCode, 401);
  assert.equal((await call("os_forged-c", "10.245.2.1")).statusCode, 429);
  assert.equal((await call(live, "10.245.2.1")).statusCode, 200);
});
test("deleted, expired and disabled sessions lose their verified bucket immediately", async () => {
  for (const kind of ["deleted", "expired", "disabled"]) {
    const token = (await issueSession(user, kind)).token;
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as Parameters<typeof appSessionLimitKey>[0];
    assert.ok((await appSessionLimitKey(request))?.startsWith("session:"));
    if (kind === "deleted")
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(token),
      ]);
    if (kind === "expired")
      await pool.query(
        "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [digest(token)],
      );
    if (kind === "disabled")
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [user.id]);
    assert.equal(await appSessionLimitKey(request), null);
    const response = await call(
      token,
      `10.245.3.${kind === "deleted" ? 1 : kind === "expired" ? 2 : 3}`,
    );
    assert.equal(response.statusCode, kind === "disabled" ? 403 : 401);
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [user.id]);
  }
});
test("stricter session write limits remain shared by IP despite rotating valid device sessions", async () => {
  const tokens = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      issueSession(user, `write device ${i}`),
    ),
  );
  let response;
  for (const account of tokens)
    response = await call(
      account.token,
      "10.245.4.1",
      "/me/api-keys",
      "POST",
      {},
    );
  assert.equal(response!.statusCode, 429);
  assert.ok(response!.headers["retry-after"]);
});

test("invalid JSON still returns400 through a protected authentication route", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    remoteAddress: "10.245.6.1",
    headers: {
      authorization: `Bearer ${second}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(response.statusCode, 400);
});

test("fresh rate-window fixtures retain the original confirmation time", async () => {
  const { freshRateLimitSession } = await import("./rate-limit-session.js");
  const original = (await issueSession(user, "Proof fixture")).token;
  const at = new Date(Date.now() - 30 * 60_000);
  await pool.query(
    "UPDATE sessions SET reauthenticated_at=$2 WHERE token_hash=$1",
    [digest(original), at],
  );
  const fresh = await freshRateLimitSession(original);
  const proof = (
    await pool.query(
      "SELECT reauthenticated_at FROM sessions WHERE token_hash=$1",
      [digest(fresh)],
    )
  ).rows[0];
  assert.equal(proof.reauthenticated_at.toISOString(), at.toISOString());
});
