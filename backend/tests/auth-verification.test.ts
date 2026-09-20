import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import nodemailer from "nodemailer";

const adminEmail = `root-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = adminEmail;

// Capture every message the app tries to send, so tests can read the links.
const sent: { to: string; subject: string; text: string }[] = [];
mock.method(nodemailer, "createTransport", () => ({
  sendMail: async (m: { to: string; subject: string; text: string }) => {
    sent.push({ to: m.to, subject: m.subject, text: m.text });
    return { messageId: "test" };
  },
  close: () => {},
  verify: async () => true,
}));

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");

const app = await buildApp();

const inject = (
  method: "GET" | "POST" | "PUT",
  url: string,
  opts: { token?: string; payload?: unknown } = {},
) =>
  app.inject({
    method,
    url,
    ...(opts.token
      ? { headers: { authorization: `Bearer ${opts.token}` } }
      : {}),
    ...(opts.payload === undefined ? {} : { payload: opts.payload as object }),
  });

/** Turn a configured mail server on or off for the whole app. */
async function setMail(on: boolean) {
  if (on)
    await pool.query(
      `INSERT INTO system_settings (key, value) VALUES ('smtp', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ host: "smtp.test", port: 587, from: "orbyn@test" })],
    );
  else await pool.query("DELETE FROM system_settings WHERE key='smtp'");
  invalidateSettings();
}

const linkToken = (subjectPart: string) => {
  const mail = [...sent].reverse().find((m) => m.subject.includes(subjectPart));
  assert.ok(mail, `no email matching "${subjectPart}"`);
  return new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get(
    "token",
  )!;
};

const password = "a-long-test-password";
const register = (email: string) =>
  inject("POST", "/auth/register", { payload: { email, password, name: "T" } });

before(async () => {
  await migrate();
  await setMail(false);
});
after(async () => {
  await pool
    .query("DELETE FROM system_settings WHERE key='smtp'")
    .catch(() => {});
  await app.close();
  await pool.end();
});

test("the bootstrap admin is verified even with mail on", async () => {
  await setMail(true);
  const r = await register(adminEmail);
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().user.email_verified, true);
  assert.equal(r.json().user.role, "admin");
});

test("a new member must confirm their email before using the app", async () => {
  sent.length = 0;
  const email = `member-${randomUUID()}@example.com`;
  const reg = await register(email);
  assert.equal(reg.statusCode, 201);
  const { token, user } = reg.json();
  assert.equal(user.email_verified, false);

  // /me still works and reports the unconfirmed state.
  const me = await inject("GET", "/me", { token });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().email_verified, false);

  // Any real route is blocked until confirmed.
  assert.equal((await inject("GET", "/items", { token })).statusCode, 403);

  // The confirmation link works and unlocks the app.
  const verify = await inject("POST", "/auth/verify-email", {
    payload: { token: linkToken("Confirm your Orbyn email") },
  });
  assert.equal(verify.statusCode, 204);
  assert.equal((await inject("GET", "/items", { token })).statusCode, 200);

  // A spent link is refused.
  const again = await inject("POST", "/auth/verify-email", {
    payload: { token: linkToken("Confirm your Orbyn email") },
  });
  assert.equal(again.statusCode, 410);
});

test("resending gives a fresh confirmation link", async () => {
  sent.length = 0;
  const email = `resend-${randomUUID()}@example.com`;
  const { token } = (await register(email)).json();
  const first = linkToken("Confirm your Orbyn email");
  sent.length = 0;
  assert.equal(
    (await inject("POST", "/auth/resend-verification", { token })).statusCode,
    204,
  );
  const second = linkToken("Confirm your Orbyn email");
  assert.notEqual(first, second);
  // The newest link works; the older one is now void.
  assert.equal(
    (await inject("POST", "/auth/verify-email", { payload: { token: first } }))
      .statusCode,
    410,
  );
  assert.equal(
    (await inject("POST", "/auth/verify-email", { payload: { token: second } }))
      .statusCode,
    204,
  );
});

test("password reset never reveals whether an account exists", async () => {
  sent.length = 0;
  const email = `reset-${randomUUID()}@example.com`;
  await register(email);
  await inject("POST", "/auth/verify-email", {
    payload: { token: linkToken("Confirm your Orbyn email") },
  });
  sent.length = 0;

  // Unknown address: 204 and no email.
  const unknown = await inject("POST", "/auth/forgot-password", {
    payload: { email: `nobody-${randomUUID()}@example.com` },
  });
  assert.equal(unknown.statusCode, 204);
  assert.equal(sent.length, 0);

  // Known address: 204 and a reset email.
  const known = await inject("POST", "/auth/forgot-password", {
    payload: { email },
  });
  assert.equal(known.statusCode, 204);
  const resetToken = linkToken("Reset your Orbyn password");

  // Old sessions end; the new password signs in.
  const old = (
    await inject("POST", "/auth/login", { payload: { email, password } })
  ).json();
  const set = await inject("POST", "/auth/reset-password", {
    payload: { token: resetToken, password: "a-brand-new-password" },
  });
  assert.equal(set.statusCode, 200);
  assert.equal(
    (await inject("GET", "/me", { token: old.token })).statusCode,
    401,
  );
  assert.equal(
    (await inject("GET", "/me", { token: set.json().token })).statusCode,
    200,
  );
  const relogin = await inject("POST", "/auth/login", {
    payload: { email, password: "a-brand-new-password" },
  });
  assert.equal(relogin.statusCode, 200);
});

test("an admin can confirm a member by hand", async () => {
  const adminToken = (
    await inject("POST", "/auth/login", {
      payload: { email: adminEmail, password },
    })
  ).json().token;
  const email = `manual-${randomUUID()}@example.com`;
  const { token, user } = (await register(email)).json();
  assert.equal((await inject("GET", "/items", { token })).statusCode, 403);
  const upd = await inject("PUT", `/admin/users/${user.id}`, {
    token: adminToken,
    payload: { email_verified: true },
  });
  assert.equal(upd.statusCode, 200, upd.body);
  assert.equal(upd.json().email_verified, true);
  assert.equal((await inject("GET", "/items", { token })).statusCode, 200);
});

test("with no mail server, new accounts are usable at once", async () => {
  await setMail(false);
  const email = `nomail-${randomUUID()}@example.com`;
  const { token, user } = (await register(email)).json();
  assert.equal(user.email_verified, true);
  assert.equal((await inject("GET", "/items", { token })).statusCode, 200);
  await setMail(true);
});
