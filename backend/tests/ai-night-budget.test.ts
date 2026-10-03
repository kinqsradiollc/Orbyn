import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const adminEmail = `budget-admin-${randomUUID()}@orbyn.test`;
process.env.ADMIN_EMAILS = adminEmail;
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
await migrate();
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
const users: string[] = [];
const tokens: string[] = [];
let providerId: string;
let ip = 1;
before(async () => {
  for (const email of [
    adminEmail,
    `budget-member-${randomUUID()}@orbyn.test`,
  ]) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `10.123.1.${ip++}`,
      payload: { email, password: "long-test-password", name: "Budget tester" },
    });
    assert.equal(result.statusCode, 201, result.body);
    users.push(result.json().user.id);
    tokens.push(result.json().token);
  }
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai','Budget fixture','https://example.invalid/v1') RETURNING id",
    )
  ).rows[0].id;
});
after(async () => {
  await pool.query(
    "UPDATE ai_settings SET provider_id=NULL,model='',night_token_budget=1000000,updated_by=NULL,updated_at=now() WHERE id",
  );
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await app.close();
  await pool.end();
});
const call = (token: string | undefined, payload: object, address?: string) =>
  app.inject({
    method: "PUT",
    url: "/ai/settings/night-budget",
    remoteAddress: address ?? `10.123.2.${ip++}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
const current = async () =>
  (
    await app.inject({
      method: "GET",
      url: "/ai/providers",
      remoteAddress: `10.123.3.${ip++}`,
      headers: { authorization: `Bearer ${tokens[0]}` },
    })
  ).json().settings;

test("budget endpoint enforces authentication, permission, parsing, bounds and rate limits", async () => {
  const input = {
    night_token_budget: 1000000,
    expected_revision: "0".repeat(64),
  };
  assert.equal((await call(undefined, input)).statusCode, 401);
  assert.equal((await call(tokens[1], input)).statusCode, 403);
  const malformed = await app.inject({
    method: "PUT",
    url: "/ai/settings/night-budget",
    remoteAddress: "10.123.4.1",
    headers: {
      authorization: `Bearer ${tokens[0]}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(
    (await call(tokens[0], { ...input, night_token_budget: 999 })).statusCode,
    422,
  );
  assert.equal(
    (await call(tokens[0], { ...input, provider_id: providerId })).statusCode,
    422,
  );
  for (let attempt = 0; attempt < 11; attempt++)
    assert.equal(
      (await call(undefined, input, "10.123.4.2")).statusCode,
      attempt === 10 ? 429 : 401,
    );
});

test("budget edits preserve provider/model and reject stale settings snapshots", async () => {
  const old = await current();
  assert.match(old.settings_revision, /^[a-f0-9]{64}$/);
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='new-model',updated_at=now() WHERE id",
    [providerId],
  );
  assert.equal(
    (
      await call(tokens[0], {
        night_token_budget: 1500000,
        expected_revision: old.settings_revision,
      })
    ).statusCode,
    409,
  );
  const fresh = await current();
  const saved = await call(tokens[0], {
    night_token_budget: 1500000,
    expected_revision: fresh.settings_revision,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().provider_id, providerId);
  assert.equal(saved.json().model, "new-model");
  assert.equal(saved.json().night_token_budget, 1500000);
  assert.notEqual(saved.json().settings_revision, fresh.settings_revision);
  const legacy = await app.inject({
    method: "PUT",
    url: "/ai/settings",
    remoteAddress: `10.123.5.${ip++}`,
    headers: { authorization: `Bearer ${tokens[0]}` },
    payload: { provider_id: null, model: "", night_token_budget: 1000000 },
  });
  assert.equal(legacy.statusCode, 409);
  const preserved = await current();
  assert.equal(preserved.provider_id, providerId);
  assert.equal(preserved.model, "new-model");
  assert.equal(preserved.night_token_budget, 1500000);
});

test("two concurrent budget writes from one snapshot produce one success and one conflict", async () => {
  const snapshot = await current();
  const results = await Promise.all(
    [1200000, 1300000].map((night_token_budget) =>
      call(tokens[0], {
        night_token_budget,
        expected_revision: snapshot.settings_revision,
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [200, 409],
  );
  const final = await current();
  assert.equal(final.provider_id, providerId);
  assert.equal(final.model, "new-model");
  assert.ok([1200000, 1300000].includes(final.night_token_budget));
});
