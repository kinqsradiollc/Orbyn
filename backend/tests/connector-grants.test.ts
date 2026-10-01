import "./setup.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { digest } = await import("../src/lib/auth.js");
const { env } = await import("../src/config/env.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const app = await buildApp();
let userId: string;
const clientId = `connector-fixture-${randomUUID()}`;
const mcpToken = `oat_${randomUUID()}`;
const pluginToken = `oat_${randomUUID()}`;
const post = (
  token: string,
  payload: object = { jsonrpc: "2.0", id: 1, method: "ping" },
) =>
  app.inject({
    method: "POST",
    url: "/mcp",
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
before(async () => {
  await migrate();
  await migrate();
  userId = (
    await pool.query(
      "INSERT INTO users(email,name,password_hash) VALUES ($1,'Fixture','unusable-test-hash') RETURNING id",
      [`connector-${randomUUID()}@example.com`],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO oauth_clients(id,kind,name,host,redirect_uris) VALUES ($1,'dcr','Fixture','fixture.example.test',ARRAY['https://fixture.example.test/callback'])",
    [clientId],
  );
  for (const [kind, token] of [
    ["mcp", mcpToken],
    ["plugin", pluginToken],
  ]) {
    const grant = (
      await pool.query(
        "INSERT INTO agent_grants(user_id,kind,client_id,resource_kind,authorized_at) VALUES ($1,'oauth',$2,$3,now()) RETURNING id",
        [userId, clientId, kind],
      )
    ).rows[0].id;
    // Deliberately use MCP resource even for the plugin grant: grant isolation
    // must reject a wrong-service connection independently of token metadata.
    await pool.query(
      "INSERT INTO agent_tokens(token_hash,grant_id,kind,resource,expires_at) VALUES ($1,$2,'access',$3,now()+interval '1 hour')",
      [digest(token), grant, env.MCP_PUBLIC_URL],
    );
  }
});
after(async () => {
  await pool.query(
    "DELETE FROM system_settings WHERE key='rate_limit_per_minute'",
  );
  invalidateSettings();
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
  await app.close();
  await pool.end();
});

test("the same app has distinct grants, while duplicates and plugin keys are rejected", async () => {
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS count FROM agent_grants WHERE user_id=$1 AND client_id=$2",
        [userId, clientId],
      )
    ).rows[0].count,
    2,
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO agent_grants(user_id,kind,client_id,resource_kind) VALUES ($1,'oauth',$2,'mcp')",
      [userId, clientId],
    ),
    (error: any) => error.code === "23505",
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO agent_grants(user_id,kind,resource_kind) VALUES ($1,'key','plugin')",
      [userId],
    ),
    (error: any) => error.code === "23514",
  );
});
test("MCP rejects plugin and session credentials and preserves its security gates", async () => {
  assert.equal((await post(pluginToken)).statusCode, 401);
  assert.equal((await post("first-party-session-fixture")).statusCode, 401);
  assert.equal((await post(mcpToken)).statusCode, 200);
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [userId]);
  assert.equal((await post(mcpToken)).statusCode, 403);
  await pool.query("UPDATE users SET disabled=false WHERE id=$1", [userId]);
  assert.equal((await post(mcpToken, {})).statusCode, 400);
});
test("resource-aware MCP calls retain per-connection rate limiting", async () => {
  await pool.query(
    "INSERT INTO system_settings(key,value) VALUES ('rate_limit_per_minute','3'::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  invalidateSettings();
  let response;
  for (let at = 0; at < 4; at++)
    response = await post(mcpToken, { jsonrpc: "2.0", id: at, method: "ping" });
  assert.equal(response!.statusCode, 429);
  assert.ok(Number(response!.headers["retry-after"]) > 0);
});
