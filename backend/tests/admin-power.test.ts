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
let memberId = "";
let memberEmail = "";

const call = (
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": `test-${randomUUID()}`,
    },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string) => {
  const email = `power-${randomUUID()}@example.com`;
  const body = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "a-long-test-password", name },
    })
  ).json();
  return { token: body.token as string, id: body.user.id as string, email };
};

before(async () => {
  await migrate();
  const a = await register("Admin");
  admin = a.token;
  adminId = a.id;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
  const m = await register("Member");
  member = m.token;
  memberId = m.id;
  memberEmail = m.email;
});

after(async () => {
  await app.close();
  await pool.end();
});

test("members can't reach any of the new admin routes", async () => {
  for (const [method, url] of [
    ["GET", "/admin/requests/summary"],
    ["GET", "/admin/requests"],
    ["GET", "/admin/analytics"],
    ["GET", `/admin/users/${adminId}`],
    ["POST", `/admin/users/${adminId}/sign-out`],
    ["POST", `/admin/users/${adminId}/reset-link`],
    ["POST", `/admin/users/${adminId}/reset-2fa`],
    ["GET", `/admin/users/${adminId}/export`],
    ["PUT", "/admin/announcement"],
  ] as const)
    assert.equal(
      (
        await call(
          member,
          method,
          url,
          method === "PUT" ? { message: "x" } : undefined,
        )
      ).statusCode,
      403,
      `${method} ${url}`,
    );
  assert.equal(
    (await app.inject({ method: "GET", url: "/admin/requests" })).statusCode,
    401,
  );
});

test("requests are traced with their route, status, user and request id", async () => {
  const id = `trace-${randomUUID()}`;
  const res = await app.inject({
    method: "GET",
    url: "/items",
    headers: { authorization: `Bearer ${member}`, "x-request-id": id },
  });
  assert.equal(res.headers["x-request-id"], id);
  await app.inject({ method: "GET", url: "/no-such-route" });
  // Batches are written every couple of seconds.
  await new Promise((r) => setTimeout(r, 2600));
  const found = (
    await call(admin, "GET", `/admin/requests?request_id=${id}`)
  ).json();
  assert.equal(found.rows.length, 1);
  const row = found.rows[0];
  assert.equal(row.route, "/items");
  assert.equal(row.status, 200);
  assert.equal(row.user_email, memberEmail);
  const missing = (
    await call(admin, "GET", "/admin/requests?status=4xx")
  ).json();
  assert.ok(
    missing.rows.some((r: { route: string }) => r.route === "(no route)"),
  );
  assert.equal(
    (await call(admin, "GET", "/admin/requests?slow=false")).statusCode,
    200,
  );
  const summary = (
    await call(admin, "GET", "/admin/requests/summary?hours=1")
  ).json();
  assert.ok(
    summary.services.some((s: { service: string }) => s.service === "all"),
  );
  assert.ok(summary.timeline.length >= 1);
  // Health probes are left out.
  await app.inject({ method: "GET", url: "/live" });
  await new Promise((r) => setTimeout(r, 2600));
  assert.equal(
    (await call(admin, "GET", "/admin/requests?route=/live")).json().rows
      .length,
    0,
  );
});

test("analytics count active people and activity per day", async () => {
  const res = await call(admin, "GET", "/admin/analytics?days=7");
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json();
  assert.equal(data.series.length, 7);
  assert.ok(data.totals.active_today >= 1);
  assert.ok(data.totals.users >= 2);
  assert.equal(
    (await call(admin, "GET", "/admin/analytics?days=3")).statusCode,
    422,
  );
});

test("an admin can see, correct, sign out, reset and export an account", async () => {
  const detail = (await call(admin, "GET", `/admin/users/${memberId}`)).json();
  assert.equal(detail.email, memberEmail);
  assert.ok(detail.sessions.length >= 1);
  assert.equal(detail.two_factor, false);

  const renamed = await call(admin, "PUT", `/admin/users/${memberId}/profile`, {
    name: "Member Renamed",
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(
    (
      await call(admin, "PUT", `/admin/users/${memberId}/profile`, {
        email: (
          await pool.query("SELECT email FROM users WHERE id=$1", [adminId])
        ).rows[0].email,
      })
    ).statusCode,
    409,
  );

  const link = (
    await call(admin, "POST", `/admin/users/${memberId}/reset-link`)
  ).json();
  assert.match(link.link, /\/reset-password\?token=/);
  const token = new URL(link.link).searchParams.get("token");
  const reset = await app.inject({
    method: "POST",
    url: "/auth/reset-password",
    payload: { token, password: "another-long-password" },
  });
  assert.equal(reset.statusCode < 300, true, reset.body);
  member = reset.json().token;

  const cleared = (
    await call(admin, "POST", `/admin/users/${memberId}/reset-2fa`)
  ).json();
  assert.equal(cleared.cleared, false);

  const exported = await call(admin, "GET", `/admin/users/${memberId}/export`);
  assert.equal(exported.statusCode, 200);
  assert.match(String(exported.headers["content-disposition"]), /attachment/);

  assert.equal(
    (await call(admin, "POST", `/admin/users/${adminId}/sign-out`)).statusCode,
    409,
  );
  const out = (
    await call(admin, "POST", `/admin/users/${memberId}/sign-out`)
  ).json();
  assert.ok(out.ended >= 1);
  assert.equal((await call(member, "GET", "/me")).statusCode, 401);

  const trail = (await call(admin, "GET", `/admin/users/${memberId}`)).json()
    .audit;
  for (const action of [
    "user.profile_changed",
    "user.reset_link_issued",
    "user.two_factor_reset",
    "user.exported",
    "user.signed_out",
  ])
    assert.ok(
      trail.some((a: { action: string }) => a.action === action),
      action,
    );
});

test("an announcement reaches everyone until it's cleared", async () => {
  assert.equal(
    (
      await call(admin, "PUT", "/admin/announcement", {
        message: "Planned update tonight at 10pm",
        tone: "warning",
      })
    ).statusCode,
    200,
  );
  const shown = (
    await app.inject({ method: "GET", url: "/announcement" })
  ).json();
  assert.equal(shown.message, "Planned update tonight at 10pm");
  assert.equal(shown.tone, "warning");
  await call(admin, "PUT", "/admin/announcement", { message: "" });
  assert.equal(
    (await app.inject({ method: "GET", url: "/announcement" })).json(),
    null,
  );
  // One that has ended isn't shown.
  await call(admin, "PUT", "/admin/announcement", {
    message: "Old news",
    until: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(
    (await app.inject({ method: "GET", url: "/announcement" })).json(),
    null,
  );
  await call(admin, "PUT", "/admin/announcement", { message: "" });
});
