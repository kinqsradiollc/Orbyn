import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";
const { buildApp, buildPluginService } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { digest } = await import("../src/lib/auth.js");
const { resolvePluginCaller } = await import("../src/modules/plugin/auth.js");
const { settings } = await import("../src/lib/settings.js");
const { enqueuePluginAi, claimPluginAi } =
  await import("../src/modules/plugin/inference-broker.js");
const { processPluginAi } =
  await import("../src/modules/plugin/inference-worker.js");
const { setPluginAiPermission } =
  await import("../src/modules/plugin/provider-permissions.js");
const { pluginWrite } = await import("../src/modules/plugin/execute.js");
const resource = "https://plugin.fixture.invalid/plugin",
  resources = { mcp: env.MCP_PUBLIC_URL, plugin: resource };
const previousResource = env.PLUGIN_PUBLIC_URL;
const providerId = randomUUID(),
  clientId = `https://fixture.example.test/${randomUUID()}`;
const token = `oat_${randomUUID()}`,
  headers = { authorization: `Bearer ${token}` };
let app: Awaited<ReturnType<typeof buildApp>>,
  service: Awaited<ReturnType<typeof buildPluginService>>;
let owner: Person, grant: string, provider: any, prior: any;
const wireCalls: { url: string; body: any }[] = [];
const upstream = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    wireCalls.push({ url: request.url ?? "", body: JSON.parse(body) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "Managed wire answer" },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
});
function operationId() {
  const time = Date.now().toString(16).padStart(12, "0"),
    id = randomUUID();
  return `${time.slice(0, 8)}-${time.slice(8)}-7${id.slice(15)}`;
}
const enable = async (limit = 10) => {
  const view = (
    await app.inject({
      method: "GET",
      url: `/me/agents/${grant}/ai-permission`,
      headers: { authorization: `Bearer ${owner.token}` },
    })
  ).json();
  return setPluginAiPermission(owner.id, grant, {
    enabled: true,
    expected_version: view.version,
    provider: {
      id: provider.id,
      revision: provider.revision,
      model: provider.model,
    },
    max_output_tokens: 512,
    daily_call_limit: limit,
  });
};
async function enqueue(id = operationId(), prompt = "Host text") {
  const live = await settings(),
    p = (await resolvePluginCaller(headers, live, resources)).principal;
  return pluginWrite(p, headers, live, resources, (db) =>
    enqueuePluginAi(db, p, headers.authorization, { operation_id: id, prompt }),
  );
}
before(async () => {
  await migrate();
  env.PLUGIN_PUBLIC_URL = resource;
  app = await buildApp();
  service = await buildPluginService();
  owner = await helpers(app).register("plugin-inference-owner", "Owner");
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  assert.ok(address && typeof address === "object");
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
  await pool.query(
    "INSERT INTO agent_tokens(grant_id,kind,prefix,token_hash,resource,expires_at) VALUES($1,'access','oat_fixture',$2,$3,now()+interval '1 hour')",
    [grant, digest(token), resource],
  );
  prior = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await pool.query(
    "INSERT INTO ai_providers(id,kind,name,base_url) VALUES($1,'openai','Workspace AI',$2)",
    [providerId, `http://127.0.0.1:${address.port}/v1`],
  );
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='fixture-model' WHERE id",
    [providerId],
  );
  provider = {
    id: providerId,
    revision: (
      await pool.query(
        "SELECT extract(epoch from updated_at)::text AS revision FROM ai_providers WHERE id=$1",
        [providerId],
      )
    ).rows[0].revision,
    model: "fixture-model",
  };
});
afterEach(async () => {
  await pool.query("DELETE FROM plugin_ai_runs WHERE grant_id=$1", [grant]);
  await pool.query("DELETE FROM plugin_ai_permissions WHERE grant_id=$1", [
    grant,
  ]);
  await pool.query("UPDATE oauth_clients SET blocked=false WHERE id=$1", [
    clientId,
  ]);
});
after(async () => {
  env.PLUGIN_PUBLIC_URL = previousResource;
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    prior.provider_id,
    prior.model,
  ]);
  await pool.query("DELETE FROM users WHERE id=$1", [owner.id]);
  await pool.query("DELETE FROM oauth_clients WHERE id=$1", [clientId]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await app.close();
  await service.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
});

test("plugin inference keeps HTTP shields and requires explicit owner permission", async () => {
  const input = { operation_id: operationId(), prompt: "Text" };
  assert.equal(
    (
      await service.inject({
        method: "POST",
        url: "/plugin/inference",
        payload: input,
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await service.inject({
        method: "POST",
        url: "/plugin/inference",
        headers,
        payload: { ...input, provider_id: providerId },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await service.inject({
        method: "POST",
        url: "/plugin/inference",
        headers,
        payload: input,
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await service.inject({
        method: "GET",
        url: `/plugin/inference/${randomUUID()}/events`,
        headers,
      })
    ).statusCode,
    404,
  );
  await enable(1);
  const admitted = await service.inject({
    method: "POST",
    url: "/plugin/inference",
    headers,
    payload: input,
  });
  assert.equal(admitted.statusCode, 202, admitted.body);
  assert.equal(admitted.headers["cache-control"], "no-store");
  assert.equal(
    (
      await service.inject({
        method: "POST",
        url: "/plugin/inference",
        headers,
        payload: { ...input, operation_id: operationId() },
      })
    ).statusCode,
    429,
  );
});
test("concurrent duplicate requests reserve once and reject changed text", async () => {
  await enable();
  const id = operationId();
  const [one, two] = await Promise.all([enqueue(id), enqueue(id)]);
  assert.equal(one.id, two.id);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM plugin_ai_runs WHERE grant_id=$1",
          [grant],
        )
      ).rows[0].n,
    ),
    1,
  );
  await assert.rejects(enqueue(id, "Other text"), /different text/);
});
test("worker performs one bounded managed call and private reconnect never replays it", async () => {
  await enable();
  const run = await enqueue();
  let calls = 0;
  const worked = await processPluginAi(resources, {
    send: async (ai, messages, options) => {
      calls++;
      assert.equal(ai.providerId, providerId);
      assert.equal(options?.maxOutputTokens, 512);
      assert.deepEqual(messages, [{ role: "user", content: "Host text" }]);
      return "Private answer";
    },
  });
  assert.equal(worked, true);
  assert.equal(calls, 1);
  const result = await service.inject({
    method: "GET",
    url: `/plugin/inference/${run.id}/events`,
    headers,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().state, "done");
  assert.equal(result.json().text, "Private answer");
  assert.deepEqual(
    result.json().events.map((event: any) => event.state),
    ["queued", "running", "done"],
  );
  const resumed = await service.inject({
    method: "GET",
    url: `/plugin/inference/${run.id}/events?cursor=${encodeURIComponent(result.json().cursor)}`,
    headers,
  });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.deepEqual(resumed.json().events, []);
  assert.equal((await enqueue(run.operation_id)).id, run.id);
  assert.equal(
    await processPluginAi(resources, {
      send: async () => {
        calls++;
        return "must not run";
      },
    }),
    false,
  );
  assert.equal(calls, 1);
});
test("permission revocation during a provider call refuses output and retains unknown outcome", async () => {
  await enable();
  const run = await enqueue();
  let calls = 0;
  await processPluginAi(resources, {
    send: async () => {
      calls++;
      const current = (
        await pool.query(
          "SELECT version FROM plugin_ai_permissions WHERE grant_id=$1",
          [grant],
        )
      ).rows[0];
      await setPluginAiPermission(owner.id, grant, {
        enabled: false,
        expected_version: current.version,
      });
      return "Do not publish";
    },
  });
  const row = (
    await pool.query(
      "SELECT state,result,claim_token FROM plugin_ai_runs WHERE id=$1",
      [run.id],
    )
  ).rows[0];
  assert.equal(row.state, "unknown");
  assert.equal(row.result, null);
  assert.ok(row.claim_token);
  assert.equal(calls, 1);
  assert.equal(
    (
      await service.inject({
        method: "GET",
        url: `/plugin/inference/${run.id}/events`,
        headers,
      })
    ).statusCode,
    403,
  );
});
test("expired running leases become unknown rather than being claimed again", async () => {
  await enable();
  const run = await enqueue();
  const claim = await claimPluginAi(resources);
  assert.equal(claim?.run.id, run.id);
  await pool.query(
    "UPDATE plugin_ai_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [run.id],
  );
  assert.equal(await claimPluginAi(resources), null);
  assert.equal(
    (await pool.query("SELECT state FROM plugin_ai_runs WHERE id=$1", [run.id]))
      .rows[0].state,
    "unknown",
  );
  assert.equal((await enqueue(run.operation_id)).state, "unknown");
});
test("provider errors do not retry, reveal upstream details, or refund uncertain reservations", async () => {
  await enable(1);
  const run = await enqueue();
  let calls = 0;
  await processPluginAi(resources, {
    send: async () => {
      calls++;
      throw new Error("secret upstream account");
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(enqueue(), /allowance is used/);
  const result = await service.inject({
    method: "GET",
    url: `/plugin/inference/${run.id}/events`,
    headers,
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().state, "unknown");
  assert.ok(!result.body.includes("secret upstream account"));
});
test("undispatched revocation cancels work and expires old operation IDs after receipt cleanup", async () => {
  await enable();
  const run = await enqueue();
  const version = (
    await pool.query(
      "SELECT version FROM plugin_ai_permissions WHERE grant_id=$1",
      [grant],
    )
  ).rows[0].version;
  await setPluginAiPermission(owner.id, grant, {
    enabled: false,
    expected_version: version,
  });
  assert.equal(
    (await pool.query("SELECT state FROM plugin_ai_runs WHERE id=$1", [run.id]))
      .rows[0].state,
    "failed",
  );
  await enable();
  assert.equal(await claimPluginAi(resources), null);
  const old = Date.now() - 86400001,
    stamp = old.toString(16).padStart(12, "0"),
    id = `${stamp.slice(0, 8)}-${stamp.slice(8)}-7${randomUUID().slice(15)}`;
  await assert.rejects(enqueue(id), /expired/);
});

test("separate plugin grants cannot read another grant's private receipt", async () => {
  await enable();
  const run = await enqueue();
  const otherToken = `oat_${randomUUID()}`;
  const otherGrant = (
    await pool.query(
      "INSERT INTO agent_grants(user_id,kind,resource_kind,client_id,access,personal,toolsets,authorized_at) VALUES($1,'oauth','plugin',$2,'read',true,ARRAY['core'],now()) RETURNING id",
      [owner.id, clientId],
    )
  ).rows[0].id;
  try {
    await pool.query(
      "INSERT INTO agent_tokens(grant_id,kind,prefix,token_hash,resource,expires_at) VALUES($1,'access','oat_fixture',$2,$3,now()+interval '1 hour')",
      [otherGrant, digest(otherToken), resource],
    );
    const result = await service.inject({
      method: "GET",
      url: `/plugin/inference/${run.id}/events`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assert.equal(result.statusCode, 404, result.body);
    assert.ok(!result.body.includes("Host text"));
  } finally {
    await pool.query("DELETE FROM agent_grants WHERE id=$1", [otherGrant]);
  }
});

test("changed workspace model refuses queued work before dispatch", async () => {
  await enable();
  const run = await enqueue();
  await pool.query("UPDATE ai_settings SET model='changed-model' WHERE id");
  try {
    let calls = 0;
    assert.equal(
      await processPluginAi(resources, {
        send: async () => {
          calls++;
          return "Unexpected";
        },
      }),
      false,
    );
    assert.equal(calls, 0);
    const stored = (
      await pool.query(
        "SELECT state,claim_token,result FROM plugin_ai_runs WHERE id=$1",
        [run.id],
      )
    ).rows[0];
    assert.equal(stored.state, "failed");
    assert.equal(stored.claim_token, null);
    assert.equal(stored.result, null);
  } finally {
    await pool.query("UPDATE ai_settings SET model=$1 WHERE id", [
      provider.model,
    ]);
  }
});

test("parallel plugin claims respect the separate persisted capacity", async () => {
  await enable();
  await enqueue();
  await enqueue();
  await enqueue();
  const claims = await Promise.all([
    claimPluginAi(resources),
    claimPluginAi(resources),
    claimPluginAi(resources),
  ]);
  // Contention may admit fewer in one pulse; repeat pulses can fill, never exceed, two.
  assert.ok(claims.filter(Boolean).length <= 2);
  await claimPluginAi(resources);
  await claimPluginAi(resources);
  const states = (
    await pool.query(
      "SELECT state,count(*)::int AS n FROM plugin_ai_runs WHERE grant_id=$1 GROUP BY state",
      [grant],
    )
  ).rows;
  assert.equal(states.find((row) => row.state === "running")?.n, 2);
  assert.equal(states.find((row) => row.state === "queued")?.n, 1);
  assert.equal(await claimPluginAi(resources), null);
});

test("managed plugin dispatch uses the actual bounded HTTP adapter and private receipt", async () => {
  await enable();
  const run = await enqueue();
  const before = wireCalls.length;
  assert.equal(await processPluginAi(resources), true);
  assert.equal(wireCalls.length, before + 1);
  const request = wireCalls.at(-1)!;
  assert.equal(request.url, "/v1/chat/completions");
  assert.equal(request.body.model, "fixture-model");
  assert.equal(request.body.max_tokens, 512);
  assert.deepEqual(request.body.messages, [
    { role: "user", content: "Host text" },
  ]);
  const result = await service.inject({
    method: "GET",
    url: `/plugin/inference/${run.id}/events`,
    headers,
  });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().state, "done");
  assert.equal(result.json().text, "Managed wire answer");
  assert.equal(await processPluginAi(resources), false);
  assert.equal(wireCalls.length, before + 1);
});
