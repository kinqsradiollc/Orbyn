import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const adminEmail = `system-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = adminEmail;
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { clearStatusCache } = await import("../src/modules/status/report.js");
const app = await buildApp();

type Account = { token: string; id: string };
let admin: Account;
let member: Account;
const register = async (email: string): Promise<Account> => {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: "System" },
  });
  assert.equal(r.statusCode, 201, r.body);
  return { token: r.json().token, id: r.json().user.id };
};
const call = (
  a: Account | null,
  method: string,
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: method as "GET",
    url,
    headers: {
      ...(a ? { authorization: `Bearer ${a.token}` } : {}),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload }),
  });

before(async () => {
  await migrate();
  await pool.query("DELETE FROM system_settings");
  invalidateSettings();
  admin = await register(adminEmail);
  member = await register(`system-member-${randomUUID()}@example.com`);
});

after(async () => {
  await pool.query("DELETE FROM system_settings");
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [admin.id, member.id],
  ]);
  await app.close();
  await pool.end();
});

test("every service reports the build it runs", async () => {
  const r = await call(null, "GET", "/version");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().version, "dev");
  assert.equal(r.json().service, "all");
});

test("settings are admin-only and apply without a restart", async () => {
  assert.equal((await call(member, "GET", "/admin/settings")).statusCode, 403);
  const start = (await call(admin, "GET", "/admin/settings")).json();
  assert.equal(start.sources.cors_origins, "environment");

  const saved = await call(admin, "PUT", "/admin/settings", {
    cors_origins: ["https://planner.example.com"],
    status_interval_ms: 45000,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().sources.cors_origins, "database");
  assert.equal(saved.json().settings.status_interval_ms, 45000);

  // The new origin is allowed at once; an unknown one is not.
  const allowed = await call(null, "GET", "/version", undefined, {
    origin: "https://planner.example.com",
  });
  assert.equal(
    allowed.headers["access-control-allow-origin"],
    "https://planner.example.com",
  );
  const other = await call(null, "GET", "/version", undefined, {
    origin: "https://evil.example.com",
  });
  assert.equal(other.headers["access-control-allow-origin"], undefined);

  const reset = await call(admin, "PUT", "/admin/settings", {
    reset: ["cors_origins", "status_interval_ms"],
  });
  assert.equal(reset.json().sources.cors_origins, "environment");
});

test("the SMTP password is stored encrypted and never returned", async () => {
  const secret = "smtp-secret-password-123";
  const r = await call(admin, "PUT", "/admin/settings", {
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "mailer",
      password: secret,
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().settings.smtp.has_password, true);
  assert.ok(!r.body.includes(secret));
  const row = (
    await pool.query("SELECT value FROM system_settings WHERE key='smtp'")
  ).rows[0];
  assert.ok(!JSON.stringify(row.value).includes(secret));
  // Keep the saved password when it is omitted; remove it with "".
  const kept = await call(admin, "PUT", "/admin/settings", {
    smtp: { port: 2525 },
  });
  assert.equal(kept.json().settings.smtp.has_password, true);
  const removed = await call(admin, "PUT", "/admin/settings", {
    smtp: { password: "" },
  });
  assert.equal(removed.json().settings.smtp.has_password, false);
  await call(admin, "PUT", "/admin/settings", { reset: ["smtp"] });
});

test("maintenance mode pauses members' changes but not admins'", async () => {
  const on = await call(admin, "PUT", "/admin/maintenance", {
    enabled: true,
    message: "Upgrading the database",
    until: null,
  });
  assert.equal(on.statusCode, 200, on.body);
  assert.equal((await call(null, "GET", "/maintenance")).json().enabled, true);

  const item = { title: "During maintenance", kind: "task" };
  const blocked = await call(member, "POST", "/items", item);
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.json().maintenance, true);
  assert.match(blocked.json().message, /Upgrading the database/);
  assert.equal((await call(member, "GET", "/items")).statusCode, 200);
  assert.equal((await call(admin, "POST", "/items", item)).statusCode, 201);

  clearStatusCache();
  const report = (await call(null, "GET", "/status")).json();
  assert.equal(report.maintenance?.message, "Upgrading the database");

  await call(admin, "PUT", "/admin/maintenance", { enabled: false });
  assert.equal((await call(member, "POST", "/items", item)).statusCode, 201);
  clearStatusCache();
  assert.equal((await call(null, "GET", "/status")).json().maintenance, null);
});

test("update checks are off until a repository is configured", async () => {
  const r = await call(admin, "GET", "/admin/updates");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().checks_enabled, false);
  assert.equal(r.json().current.version, "dev");
  assert.equal(r.json().deploy_url, null);
  assert.equal((await call(member, "GET", "/admin/updates")).statusCode, 403);
});
