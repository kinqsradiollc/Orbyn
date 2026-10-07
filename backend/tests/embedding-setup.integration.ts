import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
const adminEmail = `embedding-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = adminEmail;
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
let requests = 0;
let dimensions = 3;
let expectedModel = "embedding-fixture";
let invalidVector = false;
const paths: string[] = [];
const extraProviders: string[] = [];
let release: (() => void) | undefined;
let received: (() => void) | undefined;
let barrier: Promise<void> | undefined;
const provider = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", async () => {
    requests++;
    paths.push(req.url ?? "");
    const body = JSON.parse(raw);
    assert.deepEqual(body.input, ["Orbyn embedding configuration validation."]);
    assert.equal(body.model, expectedModel);
    received?.();
    if (barrier) await barrier;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          {
            index: 0,
            embedding: Array.from({ length: dimensions }, (_, index) =>
              !invalidVector && index === 0 ? 1 : 0,
            ),
          },
        ],
      }),
    );
  });
});
const accounts: { token: string; id: string }[] = [];
let providerId: string;
let ip = 1;
const call = (
  token: string | undefined,
  method: "PUT" | "GET",
  payload?: object,
) =>
  app.inject({
    method,
    url: method === "GET" ? "/ai/providers" : "/ai/settings/semantic",
    remoteAddress: `10.85.1.${ip++}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
const revision = async (id = providerId) => {
  const listed = (await call(accounts[0].token, "GET")).json().providers;
  const selected = listed.find(
    (provider: { id: string }) => provider.id === id,
  );
  assert.match(selected.embedding_revision, /^[1-9][0-9]*$/);
  return selected.embedding_revision as string;
};
before(async () => {
  await migrate();
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  for (const email of [
    adminEmail,
    `embedding-member-${randomUUID()}@example.com`,
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `10.85.2.${accounts.length + 1}`,
      payload: { email, name: "Fixture", password: "a-long-test-password" },
    });
    assert.equal(response.statusCode, 201, response.body);
    accounts.push({
      token: response.json().token,
      id: response.json().user.id,
    });
  }
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES ('openai','Fixture',$1) RETURNING id",
      [`http://127.0.0.1:${(provider.address() as { port: number }).port}`],
    )
  ).rows[0].id;
});
after(async () => {
  release?.();
  await pool.query(
    "UPDATE ai_settings SET embedding_search_enabled=false,embedding_provider_id=NULL,embedding_provider_revision=NULL,embedding_dimensions=NULL,semantic_accepted_at=NULL,semantic_accepted_by=NULL,embedding_model='',embedding_generation=gen_random_uuid()",
  );
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await pool.query("DELETE FROM ai_providers WHERE id=ANY($1::uuid[])", [
    extraProviders,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    accounts.map((account) => account.id),
  ]);
  await app.close();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await pool.end();
});

test("embedding setup enforces authentication, permissions, parsing and rate limits", async () => {
  assert.equal((await call(undefined, "PUT", { on: false })).statusCode, 401);
  assert.equal(
    (await call(accounts[1].token, "PUT", { on: false })).statusCode,
    403,
  );
  const malformed = await app.inject({
    method: "PUT",
    url: "/ai/settings/semantic",
    remoteAddress: "10.85.3.1",
    headers: {
      authorization: `Bearer ${accounts[0].token}`,
      "content-type": "application/json",
    },
    payload: "{",
  });
  assert.equal(malformed.statusCode, 400);
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await app.inject({
      method: "PUT",
      url: "/ai/settings/semantic",
      remoteAddress: "10.85.3.2",
      payload: { on: false },
    });
    assert.equal(response.statusCode, attempt === 10 ? 429 : 401);
  }
  assert.equal(requests, 0);
});

test("setup validates an explicit provider independently of chat and requires renewed consent", async () => {
  const settings = (await call(accounts[0].token, "GET")).json().settings;
  assert.equal(settings.source, "none");
  const missing = await call(accounts[0].token, "PUT", {
    on: true,
    embedding_model: "embedding-fixture",
    accept: true,
  });
  assert.equal(
    missing.statusCode,
    409,
    "legacy setup cannot grant a generation provider consent",
  );
  assert.equal(
    requests,
    0,
    "legacy setup sends no provider probe or page text",
  );
  assert.equal(
    (await call(accounts[0].token, "GET")).json().settings.semantic_search,
    false,
  );
  const input = {
    on: true,
    embedding_provider_id: providerId,
    embedding_model: "embedding-fixture",
    expected_generation: settings.embedding_generation,
    expected_provider_revision: await revision(),
  };
  assert.equal((await call(accounts[0].token, "PUT", input)).statusCode, 422);
  assert.equal(requests, 0, "no probe without acceptance");
  const enabled = await call(accounts[0].token, "PUT", {
    ...input,
    accept: true,
  });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.equal(enabled.json().semantic_search, true);
  assert.equal(enabled.json().source, "none");
  assert.equal(enabled.json().embedding_dimensions, 3);
  assert.equal(enabled.json().embedding_provider_id, providerId);
  assert.notEqual(
    enabled.json().embedding_generation,
    input.expected_generation,
  );
  assert.equal(
    (await call(accounts[0].token, "PUT", { ...input, accept: true }))
      .statusCode,
    409,
  );
  assert.equal(requests, 1, "stale setup is rejected before sending text");
  await pool.query("UPDATE ai_providers SET options=options WHERE id=$1", [
    providerId,
  ]);
  assert.equal(
    (await call(accounts[0].token, "GET")).json().settings.semantic_search,
    true,
    "a no-op connection update preserves accepted embedding consent",
  );
  await pool.query(
    'UPDATE ai_providers SET options=options || \'{"apiVersion":"fixture-v2"}\'::jsonb WHERE id=$1',
    [providerId],
  );
  const invalidated = (await call(accounts[0].token, "GET")).json().settings;
  assert.equal(invalidated.semantic_search, false);
  assert.equal(invalidated.embedding_needs_validation, true);
});

test("a provider edit during validation cannot commit stale consent", async () => {
  const settings = (await call(accounts[0].token, "GET")).json().settings;
  const arrival = new Promise<void>((resolve) => {
    received = resolve;
  });
  barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setup = call(accounts[0].token, "PUT", {
    on: true,
    embedding_provider_id: providerId,
    embedding_model: "embedding-fixture",
    expected_generation: settings.embedding_generation,
    expected_provider_revision: await revision(),
    accept: true,
  });
  await arrival;
  await pool.query(
    'UPDATE ai_providers SET options=options || \'{"apiVersion":"fixture-v3"}\'::jsonb WHERE id=$1',
    [providerId],
  );
  release!();
  const response = await setup;
  assert.equal(response.statusCode, 409, response.body);
  barrier = undefined;
  received = undefined;
  assert.equal(
    (await call(accounts[0].token, "GET")).json().settings.semantic_search,
    false,
  );
});

test("setup rejects missing recipients and the existing settings route can disable independently", async () => {
  const settings = (await call(accounts[0].token, "GET")).json().settings;
  const input = {
    on: true,
    embedding_provider_id: providerId,
    embedding_model: "embedding-fixture",
    expected_generation: settings.embedding_generation,
    expected_provider_revision: await revision(),
    accept: true,
  };
  const before = requests;
  assert.equal(
    (
      await call(accounts[0].token, "PUT", {
        ...input,
        embedding_provider_id: randomUUID(),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await call(accounts[0].token, "PUT", { ...input, embedding_model: "" }))
      .statusCode,
    422,
  );
  await pool.query("UPDATE ai_providers SET enabled=false WHERE id=$1", [
    providerId,
  ]);
  assert.equal((await call(accounts[0].token, "PUT", input)).statusCode, 409);
  assert.equal(requests, before, "invalid setup does not call the provider");
  await pool.query("UPDATE ai_providers SET enabled=true WHERE id=$1", [
    providerId,
  ]);
  assert.equal(
    (
      await call(accounts[0].token, "PUT", {
        ...input,
        expected_provider_revision: await revision(),
      })
    ).statusCode,
    200,
  );
  const disabled = await app.inject({
    method: "PUT",
    url: "/ai/settings",
    remoteAddress: "10.85.4.1",
    headers: { authorization: `Bearer ${accounts[0].token}` },
    payload: { provider_id: null, model: "", semantic_search: false },
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().semantic_search, false);
  assert.equal(disabled.json().semantic_accepted_at, null);
  assert.equal(
    (await pool.query("SELECT count(*)::integer AS count FROM doc_embeddings"))
      .rows[0].count,
    0,
  );
});

test("replacement validates dimensions atomically and does not inherit generation settings", async () => {
  let settings = (await call(accounts[0].token, "GET")).json().settings;
  const setup = async (provider: string, model: string) =>
    call(accounts[0].token, "PUT", {
      on: true,
      embedding_provider_id: provider,
      embedding_model: model,
      expected_generation: settings.embedding_generation,
      expected_provider_revision: await revision(provider),
      accept: true,
    });
  const initial = await setup(providerId, expectedModel);
  assert.equal(initial.statusCode, 200, initial.body);
  settings = initial.json();
  const existingPending = settings.embedding_pending_pages;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,content) VALUES ($1,'[]') RETURNING id,version",
      [accounts[0].id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO doc_embeddings(doc_id,block_id,quote,embedding,model,embedding_generation,doc_version) VALUES ($1,'fixture','old measured passage','[1,0,0]'::vector,$2,$3,$4)",
    [doc.id, expectedModel, settings.embedding_generation, doc.version],
  );
  const progress = (await call(accounts[0].token, "GET")).json().settings;
  assert.equal(progress.embedding_indexed_pages, 1);
  assert.equal(progress.embedding_pending_pages, existingPending + 1);
  const generationChanged = await app.inject({
    method: "PUT",
    url: "/ai/settings",
    remoteAddress: "10.85.4.2",
    headers: { authorization: `Bearer ${accounts[0].token}` },
    payload: { provider_id: null, model: "" },
  });
  assert.equal(generationChanged.statusCode, 200, generationChanged.body);
  assert.equal(
    generationChanged.json().embedding_generation,
    settings.embedding_generation,
  );
  assert.equal(generationChanged.json().semantic_search, true);
  invalidVector = true;
  const rejected = await setup(providerId, expectedModel);
  assert.equal(rejected.statusCode, 422, rejected.body);
  assert.equal(
    (await call(accounts[0].token, "GET")).json().settings.embedding_generation,
    settings.embedding_generation,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM doc_embeddings WHERE doc_id=$1",
        [doc.id],
      )
    ).rows[0].count,
    1,
    "failed probe preserves accepted measurements",
  );
  invalidVector = false;
  const second = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES ('openai','Second fixture',$1) RETURNING id",
      [
        `http://127.0.0.1:${(provider.address() as { port: number }).port}/second`,
      ],
    )
  ).rows[0].id;
  extraProviders.push(second);
  dimensions = 3072;
  expectedModel = "embedding-large-fixture";
  const replaced = await setup(second, expectedModel);
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.equal(replaced.json().embedding_dimensions, 3072);
  assert.equal(replaced.json().embedding_indexed_pages, 0);
  assert.equal(replaced.json().embedding_pending_pages, existingPending + 1);
  assert.equal(replaced.json().embedding_provider_id, second);
  assert.notEqual(
    replaced.json().embedding_generation,
    settings.embedding_generation,
  );
  assert.equal(paths.at(-1), "/second/embeddings");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM doc_embeddings WHERE doc_id=$1",
        [doc.id],
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM doc_embedding_queue WHERE doc_id=$1",
        [doc.id],
      )
    ).rows[0].count,
    1,
    "configuration replacement schedules fresh measurements",
  );
  const off = await call(accounts[0].token, "PUT", {
    on: false,
    expected_generation: replaced.json().embedding_generation,
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(
    off.json().embedding_pending_pages,
    undefined,
    "off does not expose an active-generation progress count",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM doc_embedding_queue WHERE doc_id=$1",
        [doc.id],
      )
    ).rows[0].count,
    0,
  );
});

test("embedding consent without a displayed provider revision cannot authorize a changed recipient", async () => {
  const settings = (await call(accounts[0].token, "GET")).json().settings;
  await pool.query(
    'UPDATE ai_providers SET options=options || \'{"fixtureDestination":"changed"}\'::jsonb WHERE id=$1',
    [providerId],
  );
  const before = requests;
  const response = await call(accounts[0].token, "PUT", {
    on: true,
    embedding_provider_id: providerId,
    embedding_model: expectedModel,
    expected_generation: settings.embedding_generation,
    accept: true,
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(requests, before, "unbound consent sends no provider probe");
});

test("displayed embedding revision fences pre-click changes and round trips without a probe", async () => {
  const settings = (await call(accounts[0].token, "GET")).json().settings;
  const reviewed = await revision();
  const options = (
    await pool.query("SELECT options FROM ai_providers WHERE id=$1", [
      providerId,
    ])
  ).rows[0].options;
  await pool.query(
    "UPDATE ai_providers SET options=options || '{\"consentRace\":true}'::jsonb WHERE id=$1",
    [providerId],
  );
  await pool.query("UPDATE ai_providers SET options=$2 WHERE id=$1", [
    providerId,
    options,
  ]);
  const before = requests;
  const response = await call(accounts[0].token, "PUT", {
    on: true,
    embedding_provider_id: providerId,
    embedding_model: expectedModel,
    expected_generation: settings.embedding_generation,
    expected_provider_revision: reviewed,
    accept: true,
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(requests, before);
  const refreshed = await call(accounts[0].token, "PUT", {
    on: true,
    embedding_provider_id: providerId,
    embedding_model: expectedModel,
    expected_generation: settings.embedding_generation,
    expected_provider_revision: await revision(),
    accept: true,
  });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.equal(requests, before + 1);
});
