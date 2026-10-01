import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
const { buildPluginService } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { digest } = await import("../src/lib/auth.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
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
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
  await Promise.all([app.close(), disabled.close()]);
  await pool.end();
});
const headers = { authorization: `Bearer ${token}` };
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
