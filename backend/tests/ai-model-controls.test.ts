import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
const email = `controls-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = email;
process.env.SECRETS_KEY = randomBytes(32).toString("base64");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
let token = "";
let member = "";
const users: string[] = [];
let providerId = "";
const call = (
  method: "GET" | "PUT" | "POST",
  url: string,
  payload?: object,
  auth = token,
) =>
  app.inject({
    method,
    url,
    headers: auth ? { authorization: `Bearer ${auth}` } : {},
    ...(payload ? { payload } : {}),
  });
before(async () => {
  await migrate();
  for (const accountEmail of [email, `member-${randomUUID()}@example.com`]) {
    const r = await call(
      "POST",
      "/auth/register",
      {
        email: accountEmail,
        password: "long-controls-fixture-password",
        name: "Controls fixture",
      },
      "",
    );
    assert.equal(r.statusCode, 201, r.body);
    users.push(r.json().user.id);
    if (!token) token = r.json().token;
    else member = r.json().token;
  }
  const r = await call("POST", "/ai/providers", {
    kind: "openai",
    name: "Controls fixture",
    api_key: "fixture-key-never-dispatched",
  });
  assert.equal(r.statusCode, 201, r.body);
  providerId = r.json().id;
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=NULL,model='' WHERE id");
  if (providerId)
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await app.close();
  await pool.end();
});
test("controls routes enforce authentication, authorization and strict bodies", async () => {
  assert.equal(
    (await call("GET", "/ai/providers", undefined, "")).statusCode,
    401,
  );
  assert.equal(
    (
      await call(
        "PUT",
        `/ai/providers/${providerId}`,
        { options: { cacheMode: "explicit" } },
        member,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("PUT", `/ai/providers/${providerId}`, {
        options: { cacheKey: "user-supplied" },
      })
    ).statusCode,
    422,
  );
  const malformed = await app.inject({
    method: "PUT",
    url: `/ai/providers/${providerId}`,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
});
test("managed usage refuses personal API keys", async () => {
  const created = await call("POST", "/me/api-keys", {
    name: "Usage boundary fixture",
  });
  assert.equal(created.statusCode, 201, created.body);
  const response = await call(
    "GET",
    "/ai/usage",
    undefined,
    created.json().key,
  );
  assert.equal(response.statusCode, 403, response.body);
  assert.equal("usage" in response.json(), false);
});
test("controls persist, active model is validated and stale saves are rejected", async () => {
  let r = await call("PUT", `/ai/providers/${providerId}`, {
    options: { reasoningEffort: "high", cacheMode: "explicit" },
  });
  assert.equal(r.statusCode, 200, r.body);
  const revision = r.json().updated_at;
  assert.deepEqual(r.json().options, {
    reasoningEffort: "high",
    cacheMode: "explicit",
  });
  assert.equal("api_key_encrypted" in r.json(), false);
  r = await call("PUT", "/ai/settings", {
    provider_id: providerId,
    model: "unknown-model",
  });
  assert.equal(r.statusCode, 422, r.body);
  r = await call("PUT", "/ai/settings", {
    provider_id: providerId,
    model: "gpt-6.1-sol",
  });
  assert.equal(r.statusCode, 200, r.body);
  r = await call("PUT", `/ai/providers/${providerId}`, {
    options: { reasoningEffort: "none" },
  });
  assert.equal(r.statusCode, 422, r.body);
  r = await call("PUT", `/ai/providers/${providerId}`, {
    name: "Renamed controls fixture",
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().options, {
    reasoningEffort: "high",
    cacheMode: "explicit",
  });
  r = await call("PUT", `/ai/providers/${providerId}`, {
    options: {},
    expected_revision: revision,
  });
  assert.equal(r.statusCode, 409, r.body);
  r = await call("GET", "/ai/providers");
  const saved = r
    .json()
    .providers.find((p: { id: string }) => p.id === providerId);
  assert.deepEqual(saved.options, {
    reasoningEffort: "high",
    cacheMode: "explicit",
  });
  assert.equal(
    (
      await call("PUT", `/ai/providers/${providerId}`, {
        options: {},
        expected_revision: saved.updated_at,
      })
    ).statusCode,
    200,
  );
});
test("unsupported model tests never dispatch and sensitive test route is rate limited", async () => {
  assert.equal(
    (
      await call("PUT", `/ai/providers/${providerId}`, {
        options: { cacheMode: "explicit" },
      })
    ).statusCode,
    200,
  );
  for (let i = 0; i < 10; i++) {
    const r = await call("POST", `/ai/providers/${providerId}/test`, {
      model: "unknown-model",
    });
    assert.equal(r.statusCode, 422, r.body);
  }
  assert.equal(
    (
      await call("POST", `/ai/providers/${providerId}/test`, {
        model: "unknown-model",
      })
    ).statusCode,
    429,
  );
});

test("durable counters deduplicate responses, isolate owners and respect opt-out", async () => {
  const { managedUsageRecorder, managedUsageSummary } =
    await import("../src/modules/ai/providers/usage.js");
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state) VALUES($1,'queued') RETURNING id",
      [users[0]],
    )
  ).rows[0].id;
  const ai = { providerId, model: "gpt-6.1-sol" } as any;
  const record = managedUsageRecorder(users[0], job, ai);
  const usage = {
    input_tokens: 100,
    output_tokens: 20,
    reasoning_tokens: 10,
    cached_input_tokens: 50,
    cache_write_tokens: 0,
  };
  await record(usage, "response-fixture");
  await record(usage, "response-fixture");
  assert.deepEqual(await managedUsageSummary(users[0]), { requests: 1, usage });
  assert.equal((await managedUsageSummary(users[1])).requests, 0);
  await managedUsageRecorder(users[1], job, ai)(usage, "not-owner");
  assert.equal((await managedUsageSummary(users[1])).requests, 0);
  await record({ ...usage, input_tokens: null }, "response-unknown");
  const partial = await managedUsageSummary(users[0]);
  assert.equal(partial.requests, 2);
  assert.equal(partial.usage.input_tokens, null);
  assert.equal(partial.usage.output_tokens, 40);
  await pool.query("UPDATE users SET analytics_opt_out=true WHERE id=$1", [
    users[0],
  ]);
  await record(usage, "opted-out");
  assert.equal((await managedUsageSummary(users[0])).requests, 2);
  const view = await call("GET", "/ai/usage");
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().enabled, false);
  assert.equal(view.json().requests, 2);
  assert.equal(
    (await call("GET", "/ai/usage", undefined, member)).json().requests,
    0,
  );
  assert.equal((await call("GET", "/ai/usage", undefined, "")).statusCode, 401);
  const stored = (
    await pool.query("SELECT event_key FROM managed_ai_usage WHERE job_id=$1", [
      job,
    ])
  ).rows;
  assert.equal(stored.length, 2);
  assert.ok(stored.every((r: any) => /^[a-f0-9]{64}$/.test(r.event_key)));
});

test("exact control revisions reject rapid edits even when timestamps are identical", async () => {
  const first = await call("GET", "/ai/providers");
  const old = first.json().providers.find((p: any) => p.id === providerId);
  assert.match(old.controls_revision, /^[1-9][0-9]*$/);
  await pool.query(
    "UPDATE ai_providers SET options=$2,updated_at=$3 WHERE id=$1",
    [providerId, { cacheMode: "implicit" }, old.updated_at],
  );
  const stale = await call("PUT", `/ai/providers/${providerId}`, {
    options: {},
    expected_revision: old.controls_revision,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  const second = (await call("GET", "/ai/providers"))
    .json()
    .providers.find((p: any) => p.id === providerId);
  assert.equal(second.updated_at, old.updated_at);
  assert.notEqual(second.controls_revision, old.controls_revision);
  assert.deepEqual(second.options, { cacheMode: "implicit" });
});

test("generation controls retain the accepted embedding connection revision", async () => {
  const { resolveEmbedding } =
    await import("../src/modules/ai/providers/resolve.js");
  const before = (
    await pool.query(
      "SELECT embedding_revision,generation_revision FROM ai_providers WHERE id=$1",
      [providerId],
    )
  ).rows[0];
  const config = {
    providerId,
    providerRevision: before.embedding_revision,
    model: "text-embedding-3-small",
    dimensions: 1536,
    generation: randomUUID(),
  };
  assert.ok(await resolveEmbedding(config));
  const saved = await call("PUT", `/ai/providers/${providerId}`, {
    options: { reasoningEffort: "high", cacheMode: "explicit" },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const after = (
    await pool.query(
      "SELECT embedding_revision,generation_revision FROM ai_providers WHERE id=$1",
      [providerId],
    )
  ).rows[0];
  assert.notEqual(after.generation_revision, before.generation_revision);
  assert.equal(after.embedding_revision, before.embedding_revision);
  const embedding = await resolveEmbedding(config);
  assert.ok(embedding);
  assert.deepEqual(embedding.options, {});
  // The dormant generation connection can save legacy retention without
  // selecting an incompatible model; embedding transport remains independent.
  await pool.query("UPDATE ai_settings SET provider_id=NULL,model='' WHERE id");
  for (const options of [
    { reasoningEffort: "low" },
    { cacheMode: "off" },
    { cacheRetention: "24h" },
  ]) {
    const result = await call("PUT", `/ai/providers/${providerId}`, {
      options,
    });
    assert.equal(result.statusCode, 200, result.body);
    const current = (
      await pool.query(
        "SELECT embedding_revision FROM ai_providers WHERE id=$1",
        [providerId],
      )
    ).rows[0];
    assert.equal(current.embedding_revision, before.embedding_revision);
    assert.ok(await resolveEmbedding(config));
  }
  let revision = before.embedding_revision;
  for (const change of [
    { base_url: "https://embedding-fixture.example.invalid/v1" },
    { api_key: "rotated-embedding-fixture-key" },
    { options: { apiVersion: "2026-10-01" } },
    { enabled: false },
    { enabled: true },
  ]) {
    const changed = await call("PUT", `/ai/providers/${providerId}`, change);
    assert.equal(changed.statusCode, 200, changed.body);
    const current = (
      await pool.query(
        "SELECT embedding_revision FROM ai_providers WHERE id=$1",
        [providerId],
      )
    ).rows[0];
    assert.ok(BigInt(current.embedding_revision) > BigInt(revision));
    revision = current.embedding_revision;
    assert.equal(await resolveEmbedding(config), null);
  }
});
