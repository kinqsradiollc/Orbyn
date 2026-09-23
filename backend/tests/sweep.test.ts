import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");

const app = await buildApp();
let admin = "";
let adminId = "";
let member = "";

const call = (
  token: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `sweep-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Sweeper",
      },
    })
  ).json() as { token: string; user: { id: string } };

before(async () => {
  await migrate();
  const a = await register();
  admin = a.token;
  adminId = a.user.id;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
  member = (await register()).token;
  await pool.query("DELETE FROM system_settings WHERE key = 'retention'");
});

after(async () => {
  await pool.query("DELETE FROM system_settings WHERE key = 'retention'");
  await app.close();
  await pool.end();
});

test("the sweeper clears outdated records and keeps recent ones", async () => {
  const marker = `sweep-${randomUUID()}`;
  await pool.query(
    `INSERT INTO request_log (at, service, request_id, method, route, status, duration_ms)
     VALUES (now() - interval '30 days', 'api', $1, 'GET', '/old', 200, 5),
            (now() - interval '1 hour', 'api', $1, 'GET', '/new', 200, 5)`,
    [marker],
  );
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() - interval '1 day')`,
    [`expired-${randomUUID()}`, adminId],
  );
  const doc = (
    await pool.query<{ id: string }>(
      "INSERT INTO docs (user_id, title) VALUES ($1, 'Old page') RETURNING id",
      [adminId],
    )
  ).rows[0].id;
  await pool
    .query(
      `INSERT INTO doc_versions (doc_id, version, title, content, created_at)
     VALUES ($1, 1, 'Old page', '[]', now() - interval '3 years')`,
      [doc],
    )
    .catch(() => {});

  const res = await call(admin, "POST", "/admin/sweep/run");
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.ok(body.last.removed.request_log >= 1);
  assert.ok(body.last.removed.sessions >= 1);
  const left = (
    await pool.query<{ route: string }>(
      "SELECT route FROM request_log WHERE request_id = $1",
      [marker],
    )
  ).rows.map((r) => r.route);
  assert.deepEqual(left, ["/new"]);
  // Page history is kept forever unless an admin chooses otherwise.
  assert.equal(
    body.rules.find((r: { key: string }) => r.key === "doc_versions").days,
    0,
  );
  assert.equal(body.last.removed.doc_versions, undefined);
});

test("admins set how long things are kept, within limits", async () => {
  const set = await call(admin, "PUT", "/admin/sweep/retention", {
    request_log: 3,
    doc_versions: 365,
  });
  assert.equal(set.statusCode, 200, set.body);
  const rules = set.json().rules;
  assert.equal(
    rules.find((r: { key: string }) => r.key === "request_log").days,
    3,
  );
  assert.equal(
    rules.find((r: { key: string }) => r.key === "doc_versions").days,
    365,
  );
  // Below a rule's minimum, and rules that can't change, are refused.
  assert.equal(
    (await call(admin, "PUT", "/admin/sweep/retention", { audit_log: 10 }))
      .statusCode,
    422,
  );
  assert.equal(
    (await call(admin, "PUT", "/admin/sweep/retention", { sessions: 30 }))
      .statusCode,
    422,
  );
  // 0 keeps forever.
  assert.equal(
    (await call(admin, "PUT", "/admin/sweep/retention", { audit_log: 0 }))
      .statusCode,
    200,
  );
});

test("members can't see or run the sweeper", async () => {
  assert.equal((await call(member, "GET", "/admin/sweep")).statusCode, 403);
  assert.equal(
    (await call(member, "POST", "/admin/sweep/run")).statusCode,
    403,
  );
  assert.equal(
    (await call(member, "PUT", "/admin/sweep/retention", { request_log: 3 }))
      .statusCode,
    403,
  );
});
