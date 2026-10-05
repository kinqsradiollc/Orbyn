import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const h = helpers(app);
let owner: Person, other: Person, grant: string;
const clientId = `https://fixture.example.test/${randomUUID()}`;
let prior: any;
const providerId = randomUUID();
let address = 1;
const call = (
  method: "GET" | "PUT",
  token?: string,
  payload?: object,
  ip?: string,
) =>
  app.inject({
    method,
    url: `/me/agents/${grant}/ai-permission`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
    remoteAddress: ip ?? `10.88.2.${address++}`,
  });
before(async () => {
  await migrate();
  owner = await h.register("plugin-ai-owner", "Owner");
  other = await h.register("plugin-ai-other", "Other");
  await pool.query(
    "INSERT INTO oauth_clients(id,kind,name,host,redirect_uris) VALUES($1,'dcr','Fixture','fixture.example.test',ARRAY['https://fixture.example.test/callback'])",
    [clientId],
  );
  grant = (
    await pool.query(
      "INSERT INTO agent_grants(user_id,kind,resource_kind,client_id,access,personal,toolsets,authorized_at) VALUES($1,'oauth','plugin',$2,'read',true,ARRAY['core'],now()) RETURNING id",
      [owner.id, clientId],
    )
  ).rows[0].id;
  prior = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await pool.query(
    "INSERT INTO ai_providers(id,kind,name) VALUES($1,'openai','Test workspace AI')",
    [providerId],
  );
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='fixture-model' WHERE id",
    [providerId],
  );
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    prior.provider_id,
    prior.model,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner.id, other.id],
  ]);
  await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await app.close();
  await pool.end();
});
test("plugin AI owner consent preserves HTTP shields, defaults off, CAS and provider revision binding", async () => {
  assert.equal((await call("GET")).statusCode, 401);
  assert.equal(
    (await call("PUT", "oat_plugin", { enabled: false, expected_version: 0 }))
      .statusCode,
    401,
  );
  assert.equal((await call("GET", other.token)).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/me/agents/${grant}/ai-permission`,
        headers: {
          authorization: `Bearer ${owner.token}`,
          "content-type": "application/json",
        },
        payload: "{",
        remoteAddress: "10.88.2.200",
      })
    ).statusCode,
    400,
  );
  const review = await call("GET", owner.token);
  assert.equal(review.statusCode, 200, review.body);
  assert.equal(review.headers["cache-control"], "no-store");
  const initial = review.json();
  assert.equal(initial.enabled, false);
  assert.equal(initial.version, 0);
  assert.ok(!JSON.stringify(initial).includes("api_key"));
  assert.equal(
    (
      await call("PUT", owner.token, {
        enabled: true,
        expected_version: 0,
        access_token: "secret",
      })
    ).statusCode,
    422,
  );
  const provider = initial.available_provider;
  assert.ok(provider);
  const input = {
    enabled: true,
    expected_version: 0,
    provider: {
      id: provider.id,
      revision: provider.revision,
      model: provider.model,
    },
    max_output_tokens: 512,
    daily_call_limit: 10,
  };
  const saved = await call("PUT", owner.token, input);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().active, true);
  assert.equal((await call("PUT", owner.token, input)).statusCode, 409);
  await pool.query(
    "UPDATE ai_providers SET updated_at=updated_at+interval '1 second' WHERE id=$1",
    [providerId],
  );
  const stale = await call("GET", owner.token);
  assert.equal(stale.json().enabled, true);
  assert.equal(stale.json().active, false);
  assert.equal(
    (await call("PUT", owner.token, { ...input, expected_version: 1 }))
      .statusCode,
    409,
  );
  await pool.query("UPDATE oauth_clients SET blocked=true WHERE id=$1", [
    clientId,
  ]);
  const disabled = await call("PUT", owner.token, {
    enabled: false,
    expected_version: 1,
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().enabled, false);
  await pool.query("UPDATE agent_grants SET resource_kind='mcp' WHERE id=$1", [
    grant,
  ]);
  assert.equal((await call("GET", owner.token)).statusCode, 403);
  await pool.query(
    "UPDATE agent_grants SET resource_kind='plugin' WHERE id=$1",
    [grant],
  );
  const statuses = [];
  for (let i = 0; i < 11; i++)
    statuses.push(
      (
        await call(
          "PUT",
          owner.token,
          { enabled: false, expected_version: 2 },
          "10.88.2.250",
        )
      ).statusCode,
    );
  assert.ok(statuses.includes(429));
});
