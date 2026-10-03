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
    { values: Array.from({ length: 4096 }, () => 0) },
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

test("plugin MCP transport resolves independent grants and retains HTTP protection", async () => {
  const payload = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  assert.equal(
    (await app.inject({ method: "POST", url: "/plugin", payload })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/plugin",
        headers: { authorization: "Bearer session-fixture" },
        payload,
      })
    ).statusCode,
    401,
  );
  const listed = await app.inject({
    method: "POST",
    url: "/plugin",
    headers,
    payload,
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers["cache-control"], "no-store");
  assert.equal(listed.headers["mcp-session-id"], undefined);
  const parsed = String(listed.headers["content-type"]).includes(
    "text/event-stream",
  )
    ? JSON.parse(
        listed.body
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      )
    : listed.json();
  assert.ok(
    parsed.result.tools.some((tool: any) => tool.name === "get_context"),
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/plugin",
        headers,
        payload: { invalid: true },
      })
    ).statusCode,
    400,
  );
  assert.equal((await app.inject({ url: "/plugin", headers })).statusCode, 405);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [userId]);
  try {
    assert.equal(
      (await app.inject({ method: "POST", url: "/plugin", headers, payload }))
        .statusCode,
      403,
    );
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [userId]);
  }
});

test("plugin UI resources require current grants, UI opt-in and bounded identifiers", async () => {
  assert.equal(
    (await app.inject({ url: "/plugin/resources" })).statusCode,
    401,
  );
  const disabledCards = await app.inject({ url: "/plugin/resources", headers });
  assert.deepEqual(disabledCards.json().resources, []);
  await pool.query(
    "INSERT INTO system_settings(key,value) VALUES ('mcp_apps_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  invalidateSettings();
  try {
    const listed = await app.inject({ url: "/plugin/resources", headers });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.headers["cache-control"], "no-store");
    assert.ok(listed.json().resources.length > 0);
    const uri = listed.json().resources[0].uri;
    const read = await app.inject({
      method: "POST",
      url: "/plugin/resources/read",
      headers,
      payload: { uri },
    });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().contents[0]._meta.ui.csp, {
      connectDomains: [],
      resourceDomains: [],
    });
    const tools = await app.inject({ url: "/plugin/tools", headers });
    assert.ok(
      tools
        .json()
        .tools.some((tool: any) => tool._meta?.ui?.resourceUri === uri),
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/plugin/resources/read",
          headers,
          payload: { uri, user_id: userId },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ url: "/plugin/resources?tenant=other", headers }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/plugin/resources/read",
          headers,
          payload: { uri: "https://private.example.test/secret" },
        })
      ).statusCode,
      403,
    );
    await pool.query("UPDATE users SET disabled=true WHERE id=$1", [userId]);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/plugin/resources/read",
          headers,
          payload: { uri },
        })
      ).statusCode,
      403,
    );
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [userId]);
    await pool.query(
      "INSERT INTO system_settings(key,value) VALUES ('rate_limit_per_minute','3'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    invalidateSettings();
    const burst = [];
    for (let n = 0; n < 4; n++)
      burst.push(
        await app.inject({
          url: "/plugin/resources",
          headers,
          remoteAddress: "10.85.2.1",
        }),
      );
    assert.ok(
      burst.some(
        (reply) => reply.statusCode === 429 && reply.headers["retry-after"],
      ),
    );
    const protocolBurst = [];
    for (let n = 0; n < 4; n++)
      protocolBurst.push(
        await app.inject({
          method: "POST",
          url: "/plugin",
          headers,
          remoteAddress: "10.85.2.2",
          payload: { jsonrpc: "2.0", id: n, method: "tools/list" },
        }),
      );
    assert.ok(
      protocolBurst.some(
        (response) =>
          response.statusCode === 429 && response.headers["retry-after"],
      ),
    );
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [userId]);
    await pool.query(
      "DELETE FROM system_settings WHERE key IN ('mcp_apps_enabled','rate_limit_per_minute')",
    );
    invalidateSettings();
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

test("plugin import job routes retain 401,403,400 and429 boundaries", async () => {
  await pool.query(
    "DELETE FROM system_settings WHERE key='rate_limit_per_minute'",
  );
  invalidateSettings();
  const job = randomUUID();
  assert.equal(
    (
      await app.inject({
        remoteAddress: "10.85.4.1",
        url: `/plugin/jobs/${job}/events`,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        remoteAddress: "10.85.4.2",
        url: `/plugin/jobs/${job}/events`,
        headers,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        remoteAddress: "10.85.4.3",
        url: `/plugin/jobs/${job}/events?cursor=x&extra=x`,
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        remoteAddress: "10.85.4.4",
        method: "POST",
        url: "/plugin/jobs/imports",
        payload: { name: "start_import", arguments: {} },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        remoteAddress: "10.85.4.5",
        method: "POST",
        url: "/plugin/jobs/imports",
        headers,
        payload: { name: "start_import", arguments: {} },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        remoteAddress: "10.85.4.6",
        method: "POST",
        url: "/plugin/jobs/imports",
        headers,
        payload: { name: "get_context", arguments: {} },
      })
    ).statusCode,
    400,
  );
  try {
    await pool.query(
      "INSERT INTO system_settings(key,value) VALUES ('rate_limit_per_minute','3'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    invalidateSettings();
    for (const [url, method, address] of [
      [`/plugin/jobs/${job}/events`, "GET", "10.85.3.1"],
      ["/plugin/jobs/imports", "POST", "10.85.3.2"],
    ] as const) {
      const replies = [];
      for (let n = 0; n < 4; n++)
        replies.push(
          await app.inject({
            url,
            method,
            headers,
            remoteAddress: address,
            ...(method === "POST"
              ? { payload: { name: "start_import", arguments: {} } }
              : {}),
          }),
        );
      assert.ok(
        replies.some(
          (reply) => reply.statusCode === 429 && reply.headers["retry-after"],
        ),
      );
    }
  } finally {
    await pool.query(
      "DELETE FROM system_settings WHERE key='rate_limit_per_minute'",
    );
    invalidateSettings();
  }
});

test("plugin import status events survive replay and completed links obey current source visibility", async () => {
  const previousFilesSecret = env.FILES_SECRET;
  env.FILES_SECRET = "fixture-only-plugin-import-secret";
  const grant = (
    await pool.query("SELECT grant_id FROM agent_tokens WHERE token_hash=$1", [
      digest(token),
    ])
  ).rows[0].grant_id;
  await pool.query(
    "UPDATE agent_grants SET access='write',trust='full',toolsets=ARRAY['files'],personal=true WHERE id=$1",
    [grant],
  );
  try {
    const payload = {
      name: "start_import",
      arguments: {
        file_name: "PRIVATE-FILE-TITLE.pdf",
        bytes: 100,
        client_ref: `plugin-import-${randomUUID()}`,
      },
    };
    const created = await app.inject({
      method: "POST",
      url: "/plugin/jobs/imports",
      headers,
      payload,
    });
    assert.equal(created.statusCode, 200);
    const tracked = created.json().job;
    assert.ok(tracked?.id);
    const imported = created
      .json()
      .result.structuredContent.done[0].id.slice("import:".length);
    const replayed = await app.inject({
      method: "POST",
      url: "/plugin/jobs/imports",
      headers,
      payload,
    });
    assert.equal(replayed.statusCode, 200);
    assert.equal(replayed.json().job.id, tracked.id);
    const protocolStart = await app.inject({
      method: "POST",
      url: "/plugin",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 100,
        method: "tools/call",
        params: payload,
      },
    });
    assert.equal(protocolStart.statusCode, 200);
    const protocolAnswer = String(
      protocolStart.headers["content-type"],
    ).includes("text/event-stream")
      ? JSON.parse(
          protocolStart.body
            .split("\n")
            .find((line) => line.startsWith("data: "))!
            .slice(6),
        )
      : protocolStart.json();
    const progress = protocolAnswer.result.content.find(
      (part: { type: string; uri?: string }) =>
        part.type === "resource_link" &&
        part.uri?.startsWith("orbyn://plugin-job/"),
    );
    assert.equal(progress.uri, `orbyn://plugin-job/${tracked.id}`);
    const modernMeta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const protocolRead = await app.inject({
      method: "POST",
      url: "/plugin",
      headers: {
        ...headers,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "resources/read",
        "mcp-name": progress.uri,
      },
      payload: {
        jsonrpc: "2.0",
        id: 101,
        method: "resources/read",
        params: { uri: progress.uri, _meta: modernMeta },
      },
    });
    assert.equal(protocolRead.statusCode, 200);
    const progressPage = JSON.parse(
      protocolRead.json().result.contents[0].text,
    );
    assert.equal(progressPage.id, tracked.id);
    assert.equal(progressPage.status, "waiting");
    const first = await app.inject({
      url: `/plugin/jobs/${tracked.id}/events`,
      headers,
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(
      first.json().events.map((event: { status: string }) => event.status),
      ["waiting"],
    );
    await pool.query("UPDATE imports SET status='queued' WHERE id=$1", [
      imported,
    ]);
    await pool.query("UPDATE imports SET status='queued' WHERE id=$1", [
      imported,
    ]);
    const second = await app.inject({
      url: `/plugin/jobs/${tracked.id}/events?cursor=${encodeURIComponent(first.json().cursor)}`,
      headers,
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(
      second.json().events.map((event: { status: string }) => event.status),
      ["queued"],
    );
    assert.doesNotMatch(second.body, /PRIVATE-FILE-TITLE/);
    const doc = (
      await pool.query(
        "INSERT INTO docs(user_id,title) VALUES ($1,'PRIVATE-DOC-TITLE') RETURNING id",
        [userId],
      )
    ).rows[0].id;
    await pool.query(
      "UPDATE imports SET status='ready',doc_id=$2 WHERE id=$1",
      [imported, doc],
    );
    const ready = await app.inject({
      url: `/plugin/jobs/${tracked.id}/events?cursor=${encodeURIComponent(second.json().cursor)}`,
      headers,
    });
    assert.equal(ready.statusCode, 200, ready.body);
    assert.equal(ready.json().result.id, `doc:${doc}`);
    assert.doesNotMatch(ready.body, /PRIVATE-FILE-TITLE|PRIVATE-DOC-TITLE/);
    await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
      grant,
    ]);
    assert.equal(
      (await app.inject({ url: `/plugin/jobs/${tracked.id}/events`, headers }))
        .statusCode,
      404,
    );
    await pool.query("UPDATE agent_grants SET personal=true WHERE id=$1", [
      grant,
    ]);
    await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [doc]);
    assert.equal(
      (await app.inject({ url: `/plugin/jobs/${tracked.id}/events`, headers }))
        .statusCode,
      404,
    );
  } finally {
    env.FILES_SECRET = previousFilesSecret;
    await pool.query(
      "UPDATE agent_grants SET access='read',toolsets=ARRAY['core'],personal=true WHERE id=$1",
      [grant],
    );
  }
});

test("plugin job replay isolates grants/accounts, bounds pages and rejects expired or mismatched cursors", async () => {
  const grant = (
    await pool.query("SELECT grant_id FROM agent_tokens WHERE token_hash=$1", [
      digest(token),
    ])
  ).rows[0].grant_id;
  await pool.query(
    "UPDATE agent_grants SET access='write',toolsets=ARRAY['files'],personal=true WHERE id=$1",
    [grant],
  );
  let request = 0;
  const read = (job: string, bearer = token, cursor?: string) =>
    app.inject({
      url: `/plugin/jobs/${job}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      headers: { authorization: `Bearer ${bearer}` },
      remoteAddress: `10.85.5.${++request}`,
    });
  const createdClients: string[] = [];
  const createdUsers: string[] = [];
  try {
    const imported = (
      await pool.query(
        "INSERT INTO imports(user_id,file_name,file_type,bytes) VALUES ($1,'PRIVATE-REPLAY-SOURCE.pdf','pdf',100) RETURNING id",
        [userId],
      )
    ).rows[0].id;
    const job = (
      await pool.query(
        "INSERT INTO plugin_import_jobs(user_id,grant_id,import_id) VALUES ($1,$2,$3) RETURNING id",
        [userId, grant, imported],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO plugin_import_events(job_id,status) SELECT $1,'waiting' FROM generate_series(1,205)",
      [job],
    );
    const first = await read(job);
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().events.length, 100);
    assert.equal(first.json().has_more, true);
    const second = await read(job, token, first.json().cursor);
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().events.length, 100);
    assert.equal(second.json().has_more, true);
    const last = await read(job, token, second.json().cursor);
    assert.equal(last.statusCode, 200);
    assert.equal(last.json().events.length, 5);
    assert.equal(last.json().has_more, false);
    const all = [
      ...first.json().events,
      ...second.json().events,
      ...last.json().events,
    ];
    assert.equal(
      new Set(all.map((event: { sequence: string }) => event.sequence)).size,
      205,
    );
    assert.doesNotMatch(
      first.body + second.body + last.body,
      /PRIVATE-REPLAY-SOURCE/,
    );
    for (const otherAccount of [false, true]) {
      const owner = otherAccount
        ? (
            await pool.query(
              "INSERT INTO users(email,name,password_hash) VALUES ($1,'Other','unusable') RETURNING id",
              [`${randomUUID()}@example.test`],
            )
          ).rows[0].id
        : userId;
      if (otherAccount) createdUsers.push(owner);
      const client = `replay-${randomUUID()}`;
      createdClients.push(client);
      await pool.query(
        "INSERT INTO oauth_clients(id,kind,name,host,redirect_uris) VALUES ($1,'dcr','Replay','fixture.example.test',ARRAY['https://fixture.example.test/callback'])",
        [client],
      );
      const otherGrant = (
        await pool.query(
          "INSERT INTO agent_grants(user_id,kind,resource_kind,client_id,access,personal,toolsets,trust,authorized_at) VALUES ($1,'oauth','plugin',$2,'write',true,ARRAY['files'],'full',now()) RETURNING id",
          [owner, client],
        )
      ).rows[0].id;
      const otherToken = `oat_${randomUUID()}`;
      await pool.query(
        "INSERT INTO agent_tokens(token_hash,grant_id,kind,resource,expires_at) VALUES ($1,$2,'access',$3,now()+interval '1 hour')",
        [digest(otherToken), otherGrant, resource],
      );
      const refused = await read(job, otherToken, first.json().cursor);
      assert.equal(refused.statusCode, 404);
      assert.ok(!refused.json().events && !refused.json().result);
    }
    const otherImport = (
      await pool.query(
        "INSERT INTO imports(user_id,file_name,file_type,bytes) VALUES ($1,'Other.pdf','pdf',100) RETURNING id",
        [userId],
      )
    ).rows[0].id;
    const otherJob = (
      await pool.query(
        "INSERT INTO plugin_import_jobs(user_id,grant_id,import_id) VALUES ($1,$2,$3) RETURNING id",
        [userId, grant, otherImport],
      )
    ).rows[0].id;
    assert.equal(
      (await read(otherJob, token, first.json().cursor)).statusCode,
      400,
    );
    assert.equal((await read(job, token, "malformed")).statusCode, 400);
    await pool.query(
      "UPDATE plugin_import_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",
      [job],
    );
    assert.equal((await read(job)).statusCode, 404);
  } finally {
    await pool.query(
      "UPDATE agent_grants SET access='read',toolsets=ARRAY['core'],personal=true WHERE id=$1",
      [grant],
    );
    for (const owner of createdUsers)
      await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    for (const client of createdClients)
      await pool.query("DELETE FROM oauth_clients WHERE id=$1", [client]);
  }
});
