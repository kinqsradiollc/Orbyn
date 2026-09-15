import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const adminEmail = `ai-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = adminEmail;
process.env.SECRETS_KEY = randomBytes(32).toString("base64");

type Seen = {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: any;
};
const seen: Seen[] = [];
const reply = (summary: string) => JSON.stringify({ summary, actions: [] });

// One stand-in server playing an OpenAI-compatible provider, Anthropic, and Azure.
const provider = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url ?? "";
    seen.push({ method: req.method ?? "", path, headers: req.headers, body });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (path === "/v1/models")
      return req.headers.authorization === "Bearer sk-openai-secret-123456"
        ? send(200, { data: [{ id: "model-b" }, { id: "model-a" }] })
        : send(401, { error: "bad key" });
    if (path === "/v1/chat/completions")
      return send(200, {
        choices: [{ message: { content: reply(`openai:${body.model}`) } }],
      });
    if (path === "/anthropic/v1/models")
      return req.headers["x-api-key"] === "sk-ant-secret-abcdef"
        ? send(200, { data: [{ id: "claude-test" }] })
        : send(401, {});
    if (path === "/anthropic/v1/messages")
      return send(200, {
        content: [{ type: "text", text: reply(`anthropic:${body.model}`) }],
      });
    if (path.startsWith("/openai/deployments/my-deploy/chat/completions"))
      return req.headers["api-key"] === "azure-secret-key-999"
        ? send(200, {
            choices: [{ message: { content: reply("azure:my-deploy") } }],
          })
        : send(401, {});
    send(404, {});
  });
});
await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();

type Account = { token: string; id: string };
const accounts: Account[] = [];
const providerIds: string[] = [];
let admin: Account;
let member: Account;

async function register(email: string): Promise<Account> {
  const r = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "a-long-test-password", name: "AI test" },
  });
  assert.equal(r.statusCode, 201, r.body);
  const account = { token: r.json().token, id: r.json().user.id };
  accounts.push(account);
  return account;
}

const call = (
  a: Account,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${a.token}` },
    ...(payload === undefined ? {} : { payload }),
  });

const chat = async (a: Account) =>
  call(a, "POST", "/ai/chat", { message: "Summarize", timezone: "UTC" });

before(async () => {
  await migrate();
  await pool.query(
    "UPDATE ai_settings SET provider_id=NULL, model='' WHERE id",
  );
  admin = await register(adminEmail);
  member = await register(`ai-member-${randomUUID()}@example.com`);
});

after(async () => {
  await pool.query(
    "UPDATE ai_settings SET provider_id=NULL, model='' WHERE id",
  );
  await pool.query("DELETE FROM ai_providers WHERE id=ANY($1::uuid[])", [
    providerIds,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    accounts.map((a) => a.id),
  ]);
  await app.close();
  await pool.end();
  provider.close();
});

test("only admins can manage AI providers", async () => {
  assert.equal((await call(member, "GET", "/ai/providers")).statusCode, 403);
  assert.equal(
    (await call(member, "POST", "/ai/providers", { kind: "openai", name: "x" }))
      .statusCode,
    403,
  );
  const list = (await call(admin, "GET", "/ai/providers")).json();
  assert.equal(list.settings.source, "none");
  // Keys can always be saved: there is no "secrets ready" gate any more.
  assert.equal("secrets_ready" in list.settings, false);
  assert.equal((await chat(member)).statusCode, 503);
});

test("keys are encrypted, masked, and never returned", async () => {
  const created = await call(admin, "POST", "/ai/providers", {
    kind: "openai-compatible",
    name: "Local mock",
    base_url: `${base}/v1`,
    api_key: "sk-openai-secret-123456",
  });
  assert.equal(created.statusCode, 201, created.body);
  const p = created.json();
  providerIds.push(p.id);
  assert.equal(p.has_key, true);
  assert.equal(p.key_hint, "sk-…3456");
  assert.ok(!created.body.includes("sk-openai-secret-123456"));
  const stored = (
    await pool.query("SELECT api_key_encrypted FROM ai_providers WHERE id=$1", [
      p.id,
    ])
  ).rows[0].api_key_encrypted;
  assert.ok(stored.startsWith("v1:") && !stored.includes("secret"));
  const listed = await call(admin, "GET", "/ai/providers");
  assert.ok(!listed.body.includes("sk-openai-secret-123456"));

  // Model listing and the connection test use the saved key.
  const models = await call(admin, "POST", `/ai/providers/${p.id}/models`);
  assert.deepEqual(models.json().models, ["model-a", "model-b"]);
  const test = await call(admin, "POST", `/ai/providers/${p.id}/test`, {
    model: "model-a",
  });
  assert.equal(test.json().ok, true, test.body);

  // Editing without a key keeps it; "" removes it.
  const renamed = await call(admin, "PUT", `/ai/providers/${p.id}`, {
    name: "Local mock 2",
  });
  assert.equal(renamed.json().has_key, true);
  const cleared = await call(admin, "PUT", `/ai/providers/${p.id}`, {
    api_key: "",
  });
  assert.equal(cleared.json().has_key, false);
  assert.equal(
    (await call(admin, "POST", `/ai/providers/${p.id}/models`)).statusCode,
    502,
  );
  await call(admin, "PUT", `/ai/providers/${p.id}`, {
    api_key: "sk-openai-secret-123456",
  });
});

test("the assistant uses the provider and model the admin picks", async () => {
  const openai = providerIds[0];
  const set = await call(admin, "PUT", "/ai/settings", {
    provider_id: openai,
    model: "model-b",
  });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().source, "database");
  const r = await chat(member);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().summary, "openai:model-b");
  const request = seen.findLast((s) => s.path === "/v1/chat/completions")!;
  assert.equal(request.headers.authorization, "Bearer sk-openai-secret-123456");

  // Anthropic: native Messages API with x-api-key and a top-level system prompt.
  const ant = (
    await call(admin, "POST", "/ai/providers", {
      kind: "anthropic",
      name: "Claude",
      base_url: `${base}/anthropic/v1`,
      api_key: "sk-ant-secret-abcdef",
    })
  ).json();
  providerIds.push(ant.id);
  assert.deepEqual(
    (await call(admin, "POST", `/ai/providers/${ant.id}/models`)).json().models,
    ["claude-test"],
  );
  await call(admin, "PUT", "/ai/settings", {
    provider_id: ant.id,
    model: "claude-test",
  });
  assert.equal((await chat(member)).json().summary, "anthropic:claude-test");
  const antRequest = seen.findLast((s) => s.path === "/anthropic/v1/messages")!;
  assert.equal(antRequest.headers["x-api-key"], "sk-ant-secret-abcdef");
  assert.equal(antRequest.headers["anthropic-version"], "2023-06-01");
  assert.equal(antRequest.headers.authorization, undefined);
  assert.equal(typeof antRequest.body.system, "string");
  assert.ok(antRequest.body.max_tokens > 0);
  assert.ok(
    antRequest.body.messages.every(
      (m: { role: string }) => m.role !== "system",
    ),
  );

  // Azure: deployment URL with api-version and the api-key header.
  assert.equal(
    (
      await call(admin, "POST", "/ai/providers", {
        kind: "azure",
        name: "Azure",
        api_key: "k",
      })
    ).statusCode,
    422,
    "Azure needs a base URL",
  );
  assert.equal(
    (
      await call(admin, "POST", "/ai/providers", {
        kind: "azure",
        name: "Azure",
        base_url: base,
        api_key: "k",
      })
    ).statusCode,
    422,
    "Azure needs an API version",
  );
  const azure = (
    await call(admin, "POST", "/ai/providers", {
      kind: "azure",
      name: "Azure",
      base_url: base,
      api_key: "azure-secret-key-999",
      options: { apiVersion: "2024-10-21" },
    })
  ).json();
  providerIds.push(azure.id);
  await call(admin, "PUT", "/ai/settings", {
    provider_id: azure.id,
    model: "my-deploy",
  });
  assert.equal((await chat(member)).json().summary, "azure:my-deploy");
  const azureRequest = seen.findLast((s) =>
    s.path.startsWith("/openai/deployments/"),
  )!;
  assert.match(azureRequest.path, /api-version=2024-10-21/);
  assert.equal(azureRequest.headers["api-key"], "azure-secret-key-999");
});

test("provider rules: metadata addresses, disabled providers, deletion, audit", async () => {
  assert.equal(
    (
      await call(admin, "POST", "/ai/providers", {
        kind: "openai-compatible",
        name: "Metadata",
        base_url: "http://169.254.169.254/latest",
      })
    ).statusCode,
    422,
  );
  const azure = providerIds[2];
  await call(admin, "PUT", `/ai/providers/${azure}`, { enabled: false });
  assert.equal(
    (
      await call(admin, "PUT", "/ai/settings", {
        provider_id: azure,
        model: "my-deploy",
      })
    ).statusCode,
    409,
  );
  // The active provider is Azure (now disabled), so the assistant is unconfigured.
  assert.equal((await chat(member)).statusCode, 503);
  await call(admin, "PUT", "/ai/settings", {
    provider_id: providerIds[1],
    model: "claude-test",
  });
  assert.equal(
    (await call(admin, "DELETE", `/ai/providers/${providerIds[1]}`)).statusCode,
    204,
  );
  assert.equal(
    (await call(admin, "GET", "/ai/providers")).json().settings.source,
    "none",
  );

  const log = (await call(admin, "GET", "/admin/audit?limit=200")).json();
  const actions = log.rows.map((e: { action: string }) => e.action);
  for (const action of [
    "ai.provider_created",
    "ai.provider_updated",
    "ai.provider_deleted",
    "ai.settings_changed",
  ])
    assert.ok(actions.includes(action), action);
  const serialized = JSON.stringify(log.rows);
  for (const secret of [
    "sk-openai-secret-123456",
    "sk-ant-secret-abcdef",
    "azure-secret-key-999",
  ])
    assert.ok(!serialized.includes(secret), "audit never contains keys");
});

test("key rules match BrainRouter: cloud keys required and at least 16 characters", async () => {
  const create = (body: object) => call(admin, "POST", "/ai/providers", body);
  const noKey = await create({ kind: "openai", name: "No key" });
  assert.equal(noKey.statusCode, 422);
  assert.match(noKey.json().message, /needs an API key/);
  const short = await create({
    kind: "openrouter",
    name: "Short",
    api_key: "sk-or-v1-x",
  });
  assert.equal(short.statusCode, 422);
  assert.match(short.json().message, /too short/);
  // opencode falls back to its public key; local servers accept any key.
  const zen = await create({ kind: "opencode", name: "Zen" });
  assert.equal(zen.statusCode, 201);
  const local = await create({
    kind: "lmstudio",
    name: "Local",
    base_url: "http://127.0.0.1:1234/v1",
    api_key: "x",
  });
  assert.equal(local.statusCode, 201);
  for (const id of [zen.json().id, local.json().id])
    assert.equal(
      (await call(admin, "DELETE", `/ai/providers/${id}`)).statusCode,
      204,
    );
});
