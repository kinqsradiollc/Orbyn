import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApp } = await import("../src/app.js");

const app = await buildApp();
const password = "a-long-test-password";
let admin = "";

const call = (
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (extra: Record<string, unknown> = {}) => {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `legal-${randomUUID()}@example.com`,
      password,
      name: "Legal",
      ...extra,
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json() as {
    token: string;
    user: { id: string; email: string; terms_version: string | null };
  };
};

const current = async () =>
  ((await call("", "GET", "/legal")).json() as { terms_version: string })
    .terms_version;

before(async () => {
  await migrate();
  await pool.query("DELETE FROM system_settings WHERE key = 'legal'");
  const a = await register();
  admin = a.token;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
    a.user.id,
  ]);
});

after(async () => {
  await pool.query("DELETE FROM system_settings WHERE key = 'legal'");
  await app.close();
  await pool.end();
});

test("anyone can read the documents, with the operator's details filled in", async () => {
  const summary = (await call("", "GET", "/legal")).json();
  assert.equal(summary.minimum_age, 16);
  const set = await call(admin, "PUT", "/admin/legal", {
    company: "Example Co",
    contact_email: "privacy@example.com",
    jurisdiction: "England and Wales",
    processors: "Hosting — Example Cloud\nEmail — Example Mail",
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.deepEqual(set.json().missing, []);
  const privacy = (await call("", "GET", "/legal/privacy")).json();
  assert.equal(privacy.title, "Privacy Policy");
  assert.match(privacy.body, /Example Co/);
  assert.match(privacy.body, /privacy@example\.com/);
  assert.match(privacy.body, /- Email — Example Mail/);
  assert.doesNotMatch(privacy.body, /\{\{/);
  const terms = (await call("", "GET", "/legal/terms")).json();
  assert.match(terms.body, /England and Wales/);
  assert.equal((await call("", "GET", "/legal/cookies")).statusCode, 404);
});

test("agreeing on the sign-up form records the version; older apps are asked later", async () => {
  const version = await current();
  const agreed = await register({ accept_terms: version });
  assert.equal(agreed.user.terms_version, version);
  const history = (await call(agreed.token, "GET", "/me/privacy")).json();
  assert.equal(history.history[0].kind, "terms");
  assert.equal(history.history[0].version, version);

  const older = await register();
  assert.equal(older.user.terms_version, null);
  // A stale version from the form doesn't count either.
  const stale = await register({ accept_terms: "2000-01-01" });
  assert.equal(stale.user.terms_version, null);

  assert.equal(
    (
      await call(older.token, "POST", "/me/consent", {
        terms_version: "2000-01-01",
      })
    ).statusCode,
    409,
  );
  const ok = await call(older.token, "POST", "/me/consent", {
    terms_version: version,
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(
    (await call(older.token, "GET", "/me")).json().terms_version,
    version,
  );
});

test("publishing a new version asks everyone to accept again", async () => {
  const before = await current();
  const person = await register({ accept_terms: before });
  const res = await call(admin, "PUT", "/admin/legal", {
    terms_body: "# Terms\n\nBe kind. Contact {{contact}}.",
    publish: ["terms"],
  });
  assert.equal(res.statusCode, 200, res.body);
  const after = await current();
  assert.notEqual(after, before);
  assert.equal(
    (await call(person.token, "GET", "/me")).json().terms_version,
    before,
    "their acceptance is of the old version, so the apps ask again",
  );
  assert.match(
    (await call("", "GET", "/legal/terms")).json().body,
    /Be kind\. Contact privacy@example\.com\./,
  );
  // Publishing again the same day still gives a newer version.
  await call(admin, "PUT", "/admin/legal", { publish: ["terms"] });
  assert.notEqual(await current(), after);
  // Publishing only the Privacy Policy also asks everyone again.
  const beforePrivacy = await current();
  await call(admin, "PUT", "/admin/legal", { publish: ["privacy"] });
  assert.notEqual(await current(), beforePrivacy);
  // Going back to the shipped text.
  await call(admin, "PUT", "/admin/legal", { terms_body: null });
  assert.match(
    (await call("", "GET", "/legal/terms")).json().body,
    /# Terms of Service/,
  );
});

test("turning analytics off stops counting and clears what was counted", async () => {
  const p = await register();
  await pool.query(
    "INSERT INTO daily_activity (day, user_id, requests, writes, ai_requests) VALUES (current_date, $1, 5, 1, 0)",
    [p.user.id],
  );
  const off = await call(p.token, "PUT", "/me/privacy", {
    analytics_opt_out: true,
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(off.json().analytics_opt_out, true);
  assert.equal(off.json().history[0].kind, "analytics");
  assert.equal(off.json().history[0].granted, false);
  const left = await pool.query(
    "SELECT 1 FROM daily_activity WHERE user_id = $1",
    [p.user.id],
  );
  assert.equal(left.rowCount, 0);
  assert.equal(
    (await call(p.token, "GET", "/me")).json().analytics_opt_out,
    true,
  );
});

test("you can delete your own account with your password", async () => {
  const p = await register();
  assert.equal(
    (await call(p.token, "DELETE", "/me", { password: "not-it-at-all" }))
      .statusCode,
    401,
  );
  assert.equal((await call(p.token, "DELETE", "/me", {})).statusCode, 422);
  const gone = await call(p.token, "DELETE", "/me", { password });
  assert.equal(gone.statusCode, 204, gone.body);
  const row = await pool.query("SELECT 1 FROM users WHERE id = $1", [
    p.user.id,
  ]);
  assert.equal(row.rowCount, 0);
  assert.equal((await call(p.token, "GET", "/me")).statusCode, 401);
});

test("the last admin can't delete themselves, and members can't edit the documents", async () => {
  const solo = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND NOT disabled",
  );
  if (solo.rows[0].n === 1) {
    assert.equal(
      (await call(admin, "DELETE", "/me", { password })).statusCode,
      409,
    );
  }
  const member = await register();
  assert.equal(
    (await call(member.token, "PUT", "/admin/legal", { company: "Nope" }))
      .statusCode,
    403,
  );
  assert.equal(
    (await call(member.token, "GET", "/admin/legal")).statusCode,
    403,
  );
});
