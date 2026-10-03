import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
const { buildPluginService } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { oauthIssuer } = await import("../src/config/env.js");
const { pluginMetadataUrl } =
  await import("../src/modules/plugin/discovery.js");
const { digest } = await import("../src/lib/auth.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { settings } = await import("../src/lib/settings.js");
const { resolvePluginCaller } = await import("../src/modules/plugin/auth.js");
const { pluginWrite } = await import("../src/modules/plugin/execute.js");
const { CapabilityError } = await import("../src/capabilities/registry.js");
let app: FastifyInstance;
let disabled: FastifyInstance;
let userId: string;
const clientId = `fixture-${randomUUID()}`;
const token = `oat_${randomUUID()}`;
const resource = "https://plugin.example.test/api";
const prior = env.PLUGIN_PUBLIC_URL;
before(async () => {
  await migrate();
  userId = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash) VALUES ($1,'Fixture','unusable') RETURNING id",
      [`${randomUUID()}@example.test`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO oauth_clients(id,kind,name,host,redirect_uris) VALUES ($1,'dcr','Fixture','fixture.example.test',ARRAY['https://fixture.example.test/callback'])",
    [clientId],
  );
  const grant = (
    await pool.query(
      "INSERT INTO agent_grants(user_id,kind,resource_kind,client_id,access,personal,toolsets,authorized_at) VALUES ($1,'oauth','plugin',$2,'read',true,ARRAY['core'],now()) RETURNING id",
      [userId, clientId],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO agent_tokens(token_hash,grant_id,kind,resource,expires_at) VALUES ($1,$2,'access',$3,now()+interval '1 hour')",
    [digest(token), grant, resource],
  );
  env.PLUGIN_PUBLIC_URL = "";
  disabled = await buildPluginService();
  env.PLUGIN_PUBLIC_URL = resource;
  app = await buildPluginService();
});
after(async () => {
  env.PLUGIN_PUBLIC_URL = prior;
  await pool.query(
    "DELETE FROM system_settings WHERE key='rate_limit_per_minute'",
  );
  invalidateSettings();
  await Promise.all([app.close(), disabled.close()]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
  await pool.end();
});
const headers = { authorization: `Bearer ${token}` };
test("plugin discovery is public, configured and isolated from MCP", async () => {
  const path = "/.well-known/oauth-protected-resource/api";
  const response = await app.inject({
    url: path,
    headers: {
      host: "attacker.example",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
      origin: "https://chatgpt.com",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://chatgpt.com",
  );
  assert.equal(response.json().resource, resource);
  assert.deepEqual(response.json().authorization_servers, [oauthIssuer()]);
  assert.deepEqual(response.json().bearer_methods_supported, ["header"]);
  assert.ok(response.json().scopes_supported.includes("orbyn:read"));
  assert.doesNotMatch(response.body, /attacker/);
  assert.equal((await disabled.inject({ url: path })).statusCode, 404);
  assert.equal(
    (await app.inject({ url: "/.well-known/oauth-protected-resource/mcp" }))
      .statusCode,
    404,
  );
  const denied = await app.inject({
    url: "/plugin/connection",
    headers: { origin: "https://chatgpt.com" },
  });
  assert.equal(denied.statusCode, 401);
  assert.match(
    String(denied.headers["access-control-expose-headers"]),
    /WWW-Authenticate/,
  );
  const untrusted = await app.inject({
    url: path,
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(untrusted.headers["access-control-allow-origin"], undefined);
  assert.equal(
    denied.headers["www-authenticate"],
    `Bearer resource_metadata="https://plugin.example.test${path}"`,
  );
  assert.equal(
    pluginMetadataUrl({
      mcp: env.MCP_PUBLIC_URL,
      plugin: "https://plugin.example.test/",
    }),
    "https://plugin.example.test/.well-known/oauth-protected-resource",
  );
  assert.equal(
    pluginMetadataUrl({ mcp: env.MCP_PUBLIC_URL, plugin: "" }),
    undefined,
  );
});
test("plugin service is disabled by default and exposes no first-party or MCP routes", async () => {
  assert.equal(
    (await disabled.inject({ url: "/plugin/connection", headers })).statusCode,
    404,
  );
  for (const url of [
    "/items",
    "/ai/settings",
    "/me",
    "/mcp",
    "/models",
    "/oauth/token",
  ])
    assert.equal((await app.inject({ url })).statusCode, 404);
  assert.equal((await app.inject({ url: "/health" })).json().service, "plugin");
});
test("plugin connection and typed catalog require plugin OAuth and reflect live permissions", async () => {
  assert.equal(
    (await app.inject({ url: "/plugin/connection" })).statusCode,
    401,
  );
  for (const credential of [
    "session-fixture",
    "ok_fixture",
    "oak_fixture",
    "ort_fixture",
  ])
    assert.equal(
      (
        await app.inject({
          url: "/plugin/connection",
          headers: { authorization: `Bearer ${credential}` },
        })
      ).statusCode,
      401,
    );
  const connection = await app.inject({ url: "/plugin/connection", headers });
  assert.equal(connection.statusCode, 200);
  assert.equal(connection.headers["cache-control"], "no-store");
  assert.equal(connection.json().kind, "plugin");
  assert.equal(connection.json().user.id, userId);
  const tools = await app.inject({ url: "/plugin/tools", headers });
  assert.equal(tools.statusCode, 200);
  assert.ok(tools.json().tools.length > 0);
  assert.ok(
    tools
      .json()
      .tools.every(
        (tool: { annotations: { readOnlyHint: boolean } }) =>
          tool.annotations.readOnlyHint,
      ),
  );
  assert.equal(
    (await app.inject({ url: "/plugin/tools?tenant=other", headers }))
      .statusCode,
    400,
  );
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [userId]);
  assert.equal(
    (await app.inject({ url: "/plugin/connection", headers })).statusCode,
    403,
  );
  await pool.query("UPDATE users SET disabled=false WHERE id=$1", [userId]);
  await pool.query("UPDATE agent_tokens SET resource=$1 WHERE token_hash=$2", [
    env.MCP_PUBLIC_URL,
    digest(token),
  ]);
  assert.equal(
    (await app.inject({ url: "/plugin/connection", headers })).statusCode,
    401,
  );
  await pool.query("UPDATE agent_tokens SET resource=$1 WHERE token_hash=$2", [
    resource,
    digest(token),
  ]);
});
test("plugin capability calls validate input and execute shared reads for the authenticated person", async () => {
  const call = (payload: object) =>
    app.inject({ method: "POST", url: "/plugin/tools/call", headers, payload });
  let nested: unknown = "private-fixture";
  for (let depth = 0; depth < 17; depth++) nested = { nested };
  for (const argumentsValue of [
    { nested },
    { values: Array.from({ length: 4096 }, () => "private-fixture") },
  ]) {
    const rejected = await call({
      name: "get_context",
      arguments: argumentsValue,
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.json().error, "INVALID");
    assert.doesNotMatch(rejected.body, /private-fixture/);
  }
  assert.equal(
    (await call({ name: "get_context", arguments: {}, approved: true }))
      .statusCode,
    400,
  );
  assert.equal(
    (await call({ name: "unknown_tool", arguments: {} })).statusCode,
    403,
  );
  assert.equal(
    (
      await call({
        name: "create_tasks",
        arguments: { tasks: [{ title: "Forbidden fixture" }] },
      })
    ).statusCode,
    403,
  );
  const answer = await call({ name: "get_context", arguments: {} });
  assert.equal(answer.statusCode, 200);
  assert.notEqual(answer.json().isError, true);
  assert.equal(answer.json().structuredContent.connection.kind, "plugin");
  assert.equal(answer.json().structuredContent.user.name, "Fixture");
  const invalid = await call({
    name: "get_context",
    arguments: { unexpected: true },
  });
  assert.equal(invalid.statusCode, 200);
  assert.equal(invalid.json().isError, true);
});

test("plugin writes use shared domain transactions and durable receipts for concurrent repeated requests", async () => {
  await pool.query(
    "UPDATE agent_grants SET access='write', trust='full' WHERE user_id=$1 AND resource_kind='plugin'",
    [userId],
  );
  const title = `Plugin fixture ${randomUUID()}`;
  const payload = {
    name: "create_tasks",
    arguments: { client_ref: randomUUID(), tasks: [{ title }] },
  };
  const call = () =>
    app.inject({ method: "POST", url: "/plugin/tools/call", headers, payload });
  try {
    const replies = await Promise.all([call(), call()]);
    for (const response of replies) {
      assert.equal(response.statusCode, 200);
      assert.notEqual(
        response.json().isError,
        true,
        JSON.stringify(response.json()),
      );
    }
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM items WHERE user_id=$1 AND title=$2",
            [userId, title],
          )
        ).rows[0].count,
      ),
      1,
    );
    assert.ok(
      replies.some((response) => response.json()._meta?.["orbyn/replayed"]),
    );
    const receipt = (
      await pool.query(
        "SELECT count(*) FROM agent_activity WHERE user_id=$1 AND tool='create_tasks'",
        [userId],
      )
    ).rows[0];
    assert.equal(Number(receipt.count), 1);
  } finally {
    await pool.query(
      "UPDATE agent_grants SET access='read' WHERE user_id=$1 AND resource_kind='plugin'",
      [userId],
    );
  }
});

test("changed and revoked connector permissions cannot enter a pending write", async () => {
  const live = await settings();
  const resources = { mcp: env.MCP_PUBLIC_URL, plugin: resource };
  const p = (await resolvePluginCaller(headers, live, resources)).principal;
  let entered = false;
  const write = () =>
    pluginWrite(p, headers, live, resources, async () => {
      entered = true;
    });
  try {
    await pool.query(
      "UPDATE agent_grants SET personal=false WHERE user_id=$1 AND resource_kind='plugin'",
      [userId],
    );
    await assert.rejects(
      write(),
      (error: unknown) =>
        error instanceof CapabilityError && error.code === "STALE",
    );
    await pool.query(
      "UPDATE agent_grants SET personal=true, revoked_at=now() WHERE user_id=$1 AND resource_kind='plugin'",
      [userId],
    );
    await assert.rejects(
      write(),
      (error: unknown) =>
        error instanceof CapabilityError && error.code === "FORBIDDEN",
    );
    assert.equal(entered, false);
  } finally {
    await pool.query(
      "UPDATE agent_grants SET personal=true, revoked_at=NULL WHERE user_id=$1 AND resource_kind='plugin'",
      [userId],
    );
  }
});

test("plugin ask-first trust queues review and host input cannot claim approval", async () => {
  await pool.query(
    "UPDATE agent_grants SET access='write', trust='ask' WHERE user_id=$1 AND resource_kind='plugin'",
    [userId],
  );
  const title = `Plugin review fixture ${randomUUID()}`;
  try {
    const response = await app.inject({
      method: "POST",
      url: "/plugin/tools/call",
      headers,
      payload: {
        name: "create_tasks",
        arguments: { tasks: [{ title }], client_ref: randomUUID() },
      },
    });
    assert.equal(response.statusCode, 200);
    assert.notEqual(
      response.json().isError,
      true,
      JSON.stringify(response.json()),
    );
    assert.ok(response.json().structuredContent.pending);
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM items WHERE user_id=$1 AND title=$2",
            [userId, title],
          )
        ).rows[0].count,
      ),
      0,
    );
  } finally {
    await pool.query(
      "UPDATE agent_grants SET access='read', trust='full' WHERE user_id=$1 AND resource_kind='plugin'",
      [userId],
    );
  }
});

test("plugin maintenance permits shared reads and denies writes", async () => {
  await pool.query(
    "UPDATE agent_grants SET access='write' WHERE user_id=$1 AND resource_kind='plugin'",
    [userId],
  );
  await pool.query(
    "INSERT INTO system_settings(key,value) VALUES ('maintenance',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [JSON.stringify({ enabled: true, message: "Fixture", until: null })],
  );
  invalidateSettings();
  try {
    const read = await app.inject({
      method: "POST",
      url: "/plugin/tools/call",
      headers,
      payload: { name: "get_context", arguments: {} },
    });
    assert.equal(read.statusCode, 200);
    assert.notEqual(read.json().isError, true);
    const write = await app.inject({
      method: "POST",
      url: "/plugin/tools/call",
      headers,
      payload: {
        name: "create_tasks",
        arguments: { tasks: [{ title: "Not during maintenance" }] },
      },
    });
    assert.equal(write.statusCode, 403);
    assert.equal(write.json().error, "READ_ONLY");
  } finally {
    await pool.query("DELETE FROM system_settings WHERE key='maintenance'");
    invalidateSettings();
    await pool.query(
      "UPDATE agent_grants SET access='read' WHERE user_id=$1 AND resource_kind='plugin'",
      [userId],
    );
  }
});

test("plugin boundary retains rate limiting and Retry-After", async () => {
  await pool.query(
    "INSERT INTO system_settings(key,value) VALUES ('rate_limit_per_minute','3'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  invalidateSettings();
  const replies = [];
  for (let n = 0; n < 4; n++)
    replies.push(
      await app.inject({
        url: "/plugin/connection",
        headers,
        remoteAddress: "10.85.1.1",
      }),
    );
  assert.ok(replies.some((reply) => reply.statusCode === 429));
  assert.ok(
    replies.find((reply) => reply.statusCode === 429)?.headers["retry-after"],
  );
});
