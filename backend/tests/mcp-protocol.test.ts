import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import {
  MODERN,
  bearer,
  helpers,
  spyPool,
  trapNetwork,
  type Person,
} from "./mcp-helpers.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { limiter } = await import("../src/modules/mcp-server/routes.js");
const { INSTRUCTIONS } = await import("../src/modules/mcp-server/server.js");
const { env } = await import("../src/config/env.js");

const app = await buildApp();
const h = helpers(app);
// Nothing leaves the machine, and reads never step outside their transaction.
const network = await trapNetwork();
const pools = await spyPool();
let me: Person;
let key = "";

before(async () => {
  await migrate();
  me = await h.register("mcp-proto", "Pat");
  key = (await h.agentKey(me, { access: "read" })).key;
});
after(async () => {
  network.restore();
  pools.restore();
  await app.close();
  await pool.end();
});

test("2026-07-28: server/discover names the revision, tools and instructions", async () => {
  const r = await h.modern(key, "server/discover");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const result = r.body.result;
  assert.deepEqual(result.supportedVersions, [MODERN]);
  assert.ok(result.capabilities.tools);
  assert.equal(result.capabilities.tools.listChanged, false);
  assert.equal(result.instructions, INSTRUCTIONS);
  assert.equal(result.ttlMs, 300_000);
  assert.equal(result.cacheScope, "private");
  assert.equal(
    result._meta["io.modelcontextprotocol/serverInfo"].name,
    "orbyn",
  );
  assert.equal(r.headers["mcp-session-id"], undefined);
  assert.match(String(r.headers["content-type"]), /application\/json/);
});

test("2026-07-28: tools/list is stable, cacheable and private; tools/call answers", async () => {
  const one = await h.modern(key, "tools/list");
  const two = await h.modern(key, "tools/list");
  assert.equal(one.status, 200);
  const names = one.body.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names, [
    "get_context",
    "search",
    "fetch",
    "get_today",
    "get_calendar",
    "query",
    "get_project",
    "find_passages",
  ]);
  assert.deepEqual(
    two.body.result.tools.map((t: { name: string }) => t.name),
    names,
  );
  assert.equal(one.body.result.ttlMs, 300_000);
  assert.equal(one.body.result.cacheScope, "private");
  for (const t of one.body.result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.equal(t.outputSchema.type, "object", t.name);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.ok(t.title, t.name);
  }
  const called = await h.modern(key, "tools/call", {
    name: "get_context",
    arguments: {},
  });
  assert.equal(called.status, 200, JSON.stringify(called.body));
  assert.equal(called.body.result.structuredContent.user.name, "Pat");
  assert.equal(called.body.result.resultType, "complete");
});

test("2026-07-28: header checks: -32020 for a mismatch, -32022 for an unknown revision", async () => {
  const mismatch = await h.modern(
    key,
    "tools/call",
    { name: "get_context", arguments: {} },
    { "mcp-method": "tools/list" },
  );
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error.code, -32020);

  const noName = await h.post(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_context",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN,
          "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      ...bearer(key),
      "mcp-protocol-version": MODERN,
      "mcp-method": "tools/call",
    },
  );
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error.code, -32020);

  const future = await h.post(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2099-01-01",
          "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      ...bearer(key),
      "mcp-protocol-version": "2099-01-01",
      "mcp-method": "tools/list",
    },
  );
  assert.equal(future.status, 400);
  assert.equal(future.body.error.code, -32022);
  assert.deepEqual(future.body.error.data.supported, [MODERN]);

  const unknown = await h.modern(key, "no/such/method");
  assert.equal(unknown.body.error.code, -32601);
});

test("2025 era: initialize for each supported revision, with no session id", async () => {
  for (const version of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
    const r = await h.legacy(key, "initialize", {
      protocolVersion: version,
      capabilities: {},
      clientInfo: { name: "old", version: "1" },
    });
    assert.equal(r.status, 200, version);
    assert.equal(r.body.result.protocolVersion, version);
    assert.equal(r.body.result.serverInfo.name, "orbyn");
    assert.equal(r.body.result.instructions, INSTRUCTIONS);
    assert.equal(r.headers["mcp-session-id"], undefined);
    assert.match(String(r.headers["content-type"]), /application\/json/);
  }
  // An older revision is offered the newest 2025 one instead.
  const old = await h.legacy(key, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "old", version: "1" },
  });
  assert.equal(old.body.result.protocolVersion, "2025-11-25");
  // ping, tools/list and a notification.
  assert.deepEqual((await h.legacy(key, "ping")).body.result, {});
  const list = await h.legacy(key, "tools/list", undefined, {
    "mcp-protocol-version": "2025-06-18",
  });
  assert.equal(list.body.result.tools.length, 8);
  assert.equal(list.body.result.ttlMs, undefined);
  const note = await h.post(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { ...bearer(key), accept: "application/json, text/event-stream" },
  );
  assert.equal(note.status, 202);
  // A client that sends no Accept header is answered in JSON all the same.
  const plain = await h.post(
    { jsonrpc: "2.0", id: 9, method: "tools/list" },
    bearer(key),
  );
  assert.equal(plain.status, 200);
  assert.equal(plain.body.result.tools.length, 8);
});

test("invalid tool arguments are an isError result the model can correct (SEP-1303)", async () => {
  const bad = await h.tool(key, "search", { query: "x", limit: 500 });
  assert.equal(bad?.isError, true);
  assert.match(bad!.content[0].text, /^INVALID: /);
  assert.match(bad!.content[0].text, /limit/);
  const extra = await h.tool(key, "search", { query: "x", surprise: 1 });
  assert.equal(extra?.isError, true);
  // An unknown tool is a protocol error.
  const unknown = await h.legacy(key, "tools/call", {
    name: "nope",
    arguments: {},
  });
  assert.equal(unknown.body.error.code, -32602);
});

test("401: no credential, an app session, a wrong key; each with the challenge", async () => {
  const challenge =
    /^Bearer .*resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp", scope="orbyn:read"$/;
  for (const headers of [
    {},
    bearer(me.token),
    bearer("oak_not-real"),
    bearer("ort_x"),
  ]) {
    const r = await h.post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      headers,
    );
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.equal(r.body.jsonrpc, "2.0");
    assert.equal(r.body.error.code, -32001);
    assert.match(String(r.headers["www-authenticate"]), challenge);
  }
  const session = await h.post(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    bearer(me.token),
  );
  assert.match(session.body.error.message, /not the app's/);
});

test("the protected-resource metadata names the canonical address and issuer", async () => {
  for (const url of [
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/oauth-protected-resource",
  ]) {
    const r = await app.inject({ url });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().resource, env.MCP_PUBLIC_URL);
    assert.ok(r.json().authorization_servers.length);
    assert.ok(r.json().scopes_supported.includes("orbyn:read"));
  }
  const other = await app.inject({ url: "/.well-known/openid-configuration" });
  assert.equal(other.statusCode, 404);
});

test("403 for a foreign Origin; allowed agent pages and CORS preflight", async () => {
  const evil = await h.post(
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    { ...bearer(key), origin: "https://evil.example" },
  );
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error.code, -32003);
  for (const origin of [
    "https://claude.ai",
    "https://chatgpt.com",
    "https://vscode.dev",
  ]) {
    const ok = await h.post(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { ...bearer(key), origin },
    );
    assert.equal(ok.status, 200, origin);
  }
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/mcp",
    headers: {
      origin: "https://claude.ai",
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-param-query",
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(
    preflight.headers["access-control-allow-origin"],
    "https://claude.ai",
  );
  assert.match(
    String(preflight.headers["access-control-allow-headers"]),
    /mcp-param-query/i,
  );
  const answered = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...bearer(key),
      origin: "https://claude.ai",
      "content-type": "application/json",
    },
    payload: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.match(
    String(answered.headers["access-control-expose-headers"]),
    /WWW-Authenticate/i,
  );
  // The API itself still answers only Orbyn's own origins.
  const api = await app.inject({
    method: "OPTIONS",
    url: "/items",
    headers: {
      origin: "https://claude.ai",
      "access-control-request-method": "GET",
    },
  });
  assert.notEqual(
    api.headers["access-control-allow-origin"],
    "https://claude.ai",
  );
});

test("405 for GET and DELETE; batches, bad JSON and params:null are refused", async () => {
  for (const method of ["GET", "DELETE"] as const) {
    const r = await app.inject({ method, url: "/mcp", headers: bearer(key) });
    assert.equal(r.statusCode, 405, method);
    assert.equal(r.headers.allow, "POST");
    assert.equal(r.json().jsonrpc, "2.0");
  }
  const batch = await h.post(
    [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ],
    bearer(key),
  );
  assert.equal(batch.status, 400);
  assert.equal(batch.body.error.code, -32600);
  assert.match(batch.body.error.message, /Batches/);

  const broken = await h.post("{not json", bearer(key));
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error.code, -32700);

  const nullParams = await h.post(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: null },
    bearer(key),
  );
  assert.equal(nullParams.status, 200);
  assert.equal(nullParams.body.id, 5);
  assert.equal(nullParams.body.error.code, -32602);

  for (const body of [
    { id: 1, method: "x" },
    { jsonrpc: "2.0", id: 1 },
    "42",
  ]) {
    const r = await h.post(body, bearer(key));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, -32600);
  }
  // subscriptions/listen isn't served (no long streams here).
  const listen = await h.modern(key, "subscriptions/listen");
  assert.equal(listen.body.error.code, -32601);
});

test("429 past a connection's limit, with Retry-After and a JSON-RPC body", async () => {
  const admin = await h.register("mcp-proto-admin");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
  const put = await h.call(admin.token, "PUT", "/admin/agents", {
    agent_limits: { calls_per_minute: 3 },
  });
  assert.equal(put.statusCode, 200, put.body);
  limiter.reset();
  try {
    const busy = (await h.agentKey(me)).key;
    let last = { status: 0, body: null as any, headers: {} as any };
    for (let i = 0; i < 4; i++)
      last = await h.post(
        { jsonrpc: "2.0", id: i, method: "ping" },
        bearer(busy),
      );
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, -32029);
    assert.ok(Number(last.headers["retry-after"]) > 0);
    assert.ok(last.body.error.data.retry_after > 0);
    // Another connection has its own allowance.
    const other = (await h.agentKey(me)).key;
    const fine = await h.post(
      { jsonrpc: "2.0", id: 1, method: "ping" },
      bearer(other),
    );
    assert.equal(fine.status, 200);
  } finally {
    await pool.query("DELETE FROM system_settings WHERE key = 'agent_limits'");
    invalidateSettings();
    limiter.reset();
  }
});

// Last: everything above ran with the network and the pools watched.
test("the MCP path never reached the network or the pool from inside a read", () => {
  assert.deepEqual(network.calls, []);
  assert.deepEqual(pools.stray, []);
});
