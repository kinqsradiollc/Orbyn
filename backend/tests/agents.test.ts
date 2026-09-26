import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { recorder, limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { runSweep } = await import("../src/lib/sweep.js");
const { env } = await import("../src/config/env.js");

const app = await buildApp();
const h = helpers(app);
let me: Person;
let admin: Person;
let teamId = "";
let apiKey = "";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const setting = async (key: string, value: unknown) => {
  await pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  invalidateSettings();
};
const clear = async (...keys: string[]) => {
  await pool.query("DELETE FROM system_settings WHERE key = ANY ($1)", [keys]);
  invalidateSettings();
};

before(async () => {
  await migrate();
  me = await h.register("agents-me", "Kim");
  admin = await h.register("agents-admin", "Root");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
  teamId = await h.team(me, "Kim's team");
  apiKey = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Old script" })
  ).json().key;
  limiter.reset();
});
after(async () => {
  await app.close();
  await pool.end();
});

test("agent keys: made once, listed without the secret, capped expiry, audited", async () => {
  const made = await h.call(me.token, "POST", "/me/agent-keys", {
    name: "MacBook · Codex CLI",
    access: "write",
    personal: true,
    team_ids: [teamId],
  });
  assert.equal(made.statusCode, 201, made.body);
  const { key, grant } = made.json();
  assert.match(key, /^oak_[A-Za-z0-9_-]{40,}$/);
  assert.equal(grant.prefix, key.slice(0, 12));
  assert.equal(grant.access, "write");
  assert.deepEqual(grant.teams, [{ id: teamId, name: "Kim's team" }]);
  const days = (Date.parse(grant.expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 29 && days <= 30, String(days));

  // Only the hash is stored.
  const stored = await pool.query(
    "SELECT token_hash FROM agent_tokens WHERE grant_id = $1",
    [grant.id],
  );
  assert.equal(stored.rows[0].token_hash, sha(key));

  const list = await h.call(me.token, "GET", "/me/agents");
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().mcp_url, env.MCP_PUBLIC_URL);
  const listed = list
    .json()
    .grants.find((g: { id: string }) => g.id === grant.id);
  assert.equal(listed.name, "MacBook · Codex CLI");
  assert.ok(!JSON.stringify(list.json()).includes(key));

  // The admin's limit caps how long a key lasts.
  const capped = await h.call(admin.token, "PUT", "/admin/agents", {
    max_grant_days: 7,
  });
  assert.equal(capped.statusCode, 200);
  try {
    const short = await h.call(me.token, "POST", "/me/agent-keys", {
      name: "Short",
      expires_in_days: 365,
    });
    const left =
      (Date.parse(short.json().grant.expires_at) - Date.now()) / 86_400_000;
    assert.ok(left <= 7, String(left));
  } finally {
    await clear("max_grant_days");
  }

  const audits = await pool.query(
    "SELECT action, details FROM audit_log WHERE target_type = 'agent_grant' AND target_id = $1",
    [grant.id],
  );
  assert.equal(audits.rows[0].action, "agent_key.created");
  assert.equal(audits.rows[0].details.prefix, grant.prefix);
  assert.ok(!JSON.stringify(audits.rows).includes(key));

  // Revoking ends it at once, keeps its history, and is audited.
  assert.equal((await h.legacy(key, "ping")).status, 200);
  const revoked = await h.call(me.token, "DELETE", `/me/agents/${grant.id}`);
  assert.equal(revoked.statusCode, 204);
  const after = await h.legacy(key, "ping");
  assert.equal(after.status, 401);
  assert.match(String(after.headers["www-authenticate"]), /invalid_token/);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agent_tokens WHERE grant_id = $1",
        [grant.id],
      )
    ).rows[0].n,
    0,
  );
  const gone = await h.call(me.token, "GET", "/me/agents");
  assert.ok(!gone.json().grants.some((g: { id: string }) => g.id === grant.id));
  const revokedAudit = await pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'agent_key.revoked' AND target_id = $1",
    [grant.id],
  );
  assert.equal(revokedAudit.rowCount, 1);
  assert.equal(
    (await h.call(me.token, "DELETE", `/me/agents/${grant.id}`)).statusCode,
    404,
  );
});

test("agent key input: 401, 422 and 404 answers", async () => {
  assert.equal(
    (await h.call(null, "POST", "/me/agent-keys", { name: "x" })).statusCode,
    401,
  );
  assert.equal((await h.call(null, "GET", "/me/agents")).statusCode, 401);
  const noSpace = await h.call(me.token, "POST", "/me/agent-keys", {
    name: "Nowhere",
    personal: false,
    team_ids: [],
  });
  assert.equal(noSpace.statusCode, 422);
  assert.match(noSpace.json().message, /at least one space/);
  const badAccess = await h.call(me.token, "POST", "/me/agent-keys", {
    name: "x",
    access: "admin",
  });
  assert.equal(badAccess.statusCode, 422);
  const stranger = await h.register("agents-stranger");
  const notMine = await h.call(stranger.token, "POST", "/me/agent-keys", {
    name: "Theirs",
    team_ids: [teamId],
  });
  assert.equal(notMine.statusCode, 404);
  // Someone else's connection is not found.
  const mine = await h.agentKey(me);
  assert.equal(
    (await h.call(stranger.token, "DELETE", `/me/agents/${mine.id}`))
      .statusCode,
    404,
  );
  assert.equal(
    (await h.call(stranger.token, "GET", `/me/agents/${mine.id}/activity`))
      .statusCode,
    404,
  );
});

test("audience isolation: agent credentials only work at the MCP address", async () => {
  const { key } = await h.agentKey(me, { access: "write" });
  // An access token as phase A2 will issue it.
  const grant = (
    await pool.query<{ id: string }>(
      `INSERT INTO agent_grants (user_id, kind, client_id, client_name, access, team_ids, expires_at)
       VALUES ($1, 'oauth', 'https://client.example/meta.json', 'Example', 'read', '{}', now() + interval '1 day')
       RETURNING id`,
      [me.id],
    )
  ).rows[0].id;
  const oat = `oat_${createHash("sha256").update(grant).digest("base64url")}`;
  await pool.query(
    `INSERT INTO agent_tokens (token_hash, grant_id, kind, resource, expires_at)
     VALUES ($1, $2, 'access', $3, now() + interval '1 hour')`,
    [sha(oat), grant, env.MCP_PUBLIC_URL],
  );
  assert.equal((await h.legacy(oat, "ping")).status, 200);
  const ctx = await h.tool(oat, "get_context");
  assert.equal(ctx!.structuredContent.connection.kind, "oauth");

  // Each probe from its own address: refused credentials count per address.
  let probe = 0;
  for (const token of [key, oat, "ort_refresh_token"])
    for (const [method, url] of [
      ["GET", "/items"],
      ["GET", "/me"],
      ["POST", "/me/api-keys"],
      ["GET", "/me/agents"],
      ["POST", "/me/agent-keys"],
      ["GET", "/me/webhooks"],
      ["POST", "/me/sessions/revoke-others"],
      ["POST", "/me/2fa/setup"],
      ["DELETE", "/me"],
      ["POST", "/ai/chat"],
      ["POST", `/ai/proposals/${grant}/apply`],
      ["GET", "/admin/users"],
      ["GET", "/docs"],
    ] as const) {
      const r = await app.inject({
        method,
        url,
        remoteAddress: `10.56.0.${++probe}`,
        headers: { authorization: `Bearer ${token}` },
        ...(method === "GET" ? {} : { payload: {} }),
      });
      assert.equal(r.statusCode, 401, `${token.slice(0, 4)} ${method} ${url}`);
    }
  const rest = await h.call(key, "GET", "/items");
  assert.match(rest.json().message, /only with Orbyn's MCP address/);

  // CalDAV takes only personal API keys as the password.
  const dav = await app.inject({
    method: "PROPFIND",
    url: "/dav/",
    headers: {
      authorization: `Basic ${Buffer.from(`${me.email}:${key}`).toString("base64")}`,
      depth: "0",
    },
  });
  assert.equal(dav.statusCode, 401);

  // A browser session is refused at /mcp; a personal API key can't make agent keys.
  assert.equal((await h.legacy(me.token, "ping")).status, 401);
  const viaApiKey = await h.call(apiKey, "POST", "/me/agent-keys", {
    name: "sneaky",
  });
  assert.equal(viaApiKey.statusCode, 403);
  assert.equal((await h.call(apiKey, "GET", "/me/agents")).statusCode, 403);

  // An expired or foreign-audience token is refused.
  await pool.query(
    "UPDATE agent_tokens SET resource = 'https://elsewhere.example/mcp' WHERE grant_id = $1",
    [grant],
  );
  assert.equal((await h.legacy(oat, "ping")).status, 401);
  await pool.query(
    "UPDATE agent_tokens SET resource = $2, expires_at = now() - interval '1 minute' WHERE grant_id = $1",
    [grant, env.MCP_PUBLIC_URL],
  );
  assert.equal((await h.legacy(oat, "ping")).status, 401);
});

test("old personal API keys: a legacy connection on MCP with a Deprecation notice, until the date", async () => {
  const init = await h.legacy(apiKey, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "script", version: "1" },
  });
  assert.equal(init.status, 200);
  assert.match(String(init.headers.deprecation), /^@\d+$/);
  assert.ok(Date.parse(String(init.headers.sunset)) > Date.now());
  const list = await h.legacy(apiKey, "tools/list");
  const names = list.body.result.tools.map((t: { name: string }) => t.name);
  for (const alias of ["search_items", "add_task", "get_agenda"])
    assert.ok(names.includes(alias));
  assert.ok(names.includes("search"));
  // Agent keys don't get the old aliases.
  const { key } = await h.agentKey(me);
  const fresh = (await h.legacy(key, "tools/list")).body.result.tools.map(
    (t: { name: string }) => t.name,
  );
  assert.ok(!fresh.includes("add_task"));
  assert.equal((await h.legacy(key, "ping")).headers.deprecation, undefined);

  // It shows in Connected agents, and can be disconnected from MCP alone.
  const overview = (await h.call(me.token, "GET", "/me/agents")).json();
  assert.ok(overview.legacy_keys_until);
  const legacy = overview.grants.find(
    (g: { kind: string }) => g.kind === "legacy",
  );
  assert.equal(legacy.name, "Old script");
  assert.equal(legacy.team_ids, null);
  assert.equal(
    (await h.call(me.token, "DELETE", `/me/agents/${legacy.id}`)).statusCode,
    204,
  );
  const refused = await h.legacy(apiKey, "ping");
  assert.equal(refused.status, 401);
  assert.match(refused.body.error.message, /still works with the REST API/);
  assert.equal((await h.call(apiKey, "GET", "/items")).statusCode, 200);

  // After the date, old keys are refused on MCP but still work on REST.
  const other = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Later" })
  ).json().key;
  const until = (
    await pool.query(
      "SELECT value FROM system_settings WHERE key = 'agents_legacy_keys_until'",
    )
  ).rows[0]?.value;
  await setting(
    "agents_legacy_keys_until",
    new Date(Date.now() - 1000).toISOString(),
  );
  try {
    const late = await h.legacy(other, "ping");
    assert.equal(late.status, 401);
    assert.match(late.body.error.message, /no longer work with MCP/);
    assert.equal((await h.call(other, "GET", "/items")).statusCode, 200);
    assert.equal(
      (await h.call(me.token, "GET", "/me/agents")).json().legacy_keys_until,
      null,
    );
  } finally {
    if (until === undefined) await clear("agents_legacy_keys_until");
    else await setting("agents_legacy_keys_until", until);
  }

  // With the settings cleared, the 90 days still run from the release that
  // added agent access, so old keys aren't cut off early.
  await clear("agents_legacy_keys_until");
  try {
    assert.equal((await h.legacy(other, "ping")).status, 200);
    const shown = (await h.call(me.token, "GET", "/me/agents")).json()
      .legacy_keys_until;
    assert.ok(Date.parse(shown) > Date.now() + 60 * 86_400_000, shown);
  } finally {
    if (until !== undefined) await setting("agents_legacy_keys_until", until);
  }
});

test("kill switches: agents off (503), changes off (READ_ONLY), a blocked app (403)", async () => {
  const { key } = await h.agentKey(me);
  const off = await h.call(admin.token, "PUT", "/admin/agents", {
    agents_enabled: false,
  });
  assert.equal(off.statusCode, 200);
  assert.equal(off.json().agents_enabled, false);
  try {
    const r = await h.legacy(key, "tools/list");
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, -32002);
    assert.ok(Number(r.headers["retry-after"]) > 0);
  } finally {
    await h.call(admin.token, "PUT", "/admin/agents", { agents_enabled: true });
  }
  assert.equal((await h.legacy(key, "tools/list")).status, 200);

  // Changes paused: the old add_task alias answers READ_ONLY; reads go on.
  await h.call(admin.token, "PUT", "/admin/agents", {
    agents_writes_enabled: false,
  });
  const other = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Writer" })
  ).json().key;
  try {
    const add = await h.tool(other, "add_task", { title: "Paused change" });
    assert.equal(add?.isError, true);
    assert.match(add!.content[0].text, /^READ_ONLY/);
    const read = await h.tool(other, "search_items", { query: "anything" });
    assert.equal(read?.isError, undefined);
  } finally {
    await h.call(admin.token, "PUT", "/admin/agents", {
      agents_writes_enabled: true,
    });
  }
  const added = await h.tool(other, "add_task", { title: "Now allowed" });
  assert.match(added!.content[0].text, /Added "Now allowed"/);

  // Blocking agent keys as an app refuses them all; old keys can be blocked too.
  await h.call(admin.token, "PUT", "/admin/agents", {
    blocked_client_ids: ["orbyn-agent-key"],
  });
  try {
    const r = await h.legacy(key, "ping");
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, -32003);
  } finally {
    await h.call(admin.token, "PUT", "/admin/agents", {
      blocked_client_ids: [],
    });
  }
  // Only admins can flip the switches.
  assert.equal(
    (await h.call(me.token, "PUT", "/admin/agents", { agents_enabled: false }))
      .statusCode,
    403,
  );
  assert.equal((await h.call(null, "GET", "/admin/agents")).statusCode, 401);
  assert.equal(
    (
      await h.call(admin.token, "PUT", "/admin/agents", {
        agents_enabled: "no",
      })
    ).statusCode,
    422,
  );
  const audit = await pool.query(
    "SELECT 1 FROM audit_log WHERE action = 'agents.settings_changed' AND actor_id = $1",
    [admin.id],
  );
  assert.ok((audit.rowCount ?? 0) >= 4);
  await clear("agents_enabled", "agents_writes_enabled", "blocked_client_ids");
});

test("activity: each connection's calls are logged, reads counted per minute; none count as the person being active", async () => {
  const fresh = await h.register("agents-activity", "Ivy");
  const { key, id } = await h.agentKey(fresh);
  // Let the request log write what signing up counted.
  await new Promise((r) => setTimeout(r, 2300));
  const activityOf = async () =>
    (
      await pool.query(
        "SELECT coalesce(sum(requests), 0)::int AS n FROM daily_activity WHERE user_id = $1",
        [fresh.id],
      )
    ).rows[0].n as number;
  const before = await activityOf();
  for (let i = 0; i < 3; i++)
    await h.tool(key, "search", { query: "anything" });
  await h.tool(key, "fetch", {
    id: "task:00000000-0000-0000-0000-000000000000",
  });
  await recorder.flush();
  await new Promise((r) => setTimeout(r, 2300));
  assert.equal(await activityOf(), before);
  const logged = await pool.query(
    "SELECT route FROM request_log WHERE user_id = $1 AND route LIKE 'mcp:%'",
    [fresh.id],
  );
  assert.ok(logged.rows.some((r) => r.route === "mcp:search"));

  const activity = await h.call(
    fresh.token,
    "GET",
    `/me/agents/${id}/activity`,
  );
  assert.equal(activity.statusCode, 200);
  const rows = activity.json() as {
    tool: string;
    calls: number;
    outcome: string;
  }[];
  const search = rows.find((r) => r.tool === "search");
  assert.equal(search?.calls, 3);
  assert.equal(search?.outcome, "ok");
  assert.ok(rows.some((r) => r.tool === "fetch" && r.outcome === "denied"));
  const usage = await pool.query(
    "SELECT calls, denied FROM agent_usage_daily WHERE grant_id = $1",
    [id],
  );
  assert.equal(usage.rows[0].calls, 4);
  assert.equal(usage.rows[0].denied, 1);
  const grant = await pool.query(
    "SELECT last_used_at FROM agent_grants WHERE id = $1",
    [id],
  );
  assert.ok(grant.rows[0].last_used_at);
});

test("a write by an agent is labelled with its connection, and its reads see it", async () => {
  const project = (
    await h.call(me.token, "POST", "/projects", { name: "Agent labels" })
  ).json();
  const legacyKey = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Labeller" })
  ).json().key;
  const added = await h.tool(legacyKey, "add_task", {
    title: "Added by an agent",
  });
  const id = /id: ([0-9a-f-]{36})/.exec(added!.content[0].text)![1];
  const grant = (
    await pool.query(
      "SELECT id, last_write_at FROM agent_grants WHERE kind = 'legacy' AND name = 'Labeller'",
    )
  ).rows[0];
  assert.ok(grant.last_write_at);
  // Its next read finds the new task straight away.
  const found = await h.tool(legacyKey, "search", {
    query: "Added by an agent",
  });
  assert.ok(
    found!.structuredContent.results.some(
      (r: { id: string }) => r.id === `task:${id}`,
    ),
  );
  // Moving the task into a project from the app is labelled with nobody;
  // a change made under the connection's label is.
  await pool.query("BEGIN");
  await pool.query(
    "SELECT set_config('orbyn.agent_grant', $1, true), set_config('orbyn.user_id', $2, true)",
    [grant.id, me.id],
  );
  await pool.query("UPDATE items SET project_id = $1 WHERE id = $2", [
    project.id,
    id,
  ]);
  await pool.query("COMMIT");
  const labelled = await pool.query(
    "SELECT via_grant_id FROM project_activity WHERE project_id = $1 AND entity_id = $2",
    [project.id, id],
  );
  assert.equal(labelled.rows[0].via_grant_id, grant.id);
});

test("maintenance: reads go on, an agent's change gets a JSON-RPC error", async () => {
  const toggle = (enabled: boolean) =>
    h.call(admin.token, "PUT", "/admin/maintenance", {
      enabled,
      message: enabled ? "Moving house" : "",
      until: null,
    });
  const legacyKey = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Maint" })
  ).json().key;
  assert.equal((await toggle(true)).statusCode, 200);
  try {
    const read = await h.tool(legacyKey, "get_context");
    assert.equal(read?.isError, undefined);
    const write = await h.legacy(legacyKey, "tools/call", {
      name: "add_task",
      arguments: { title: "Not now" },
    });
    assert.equal(write.status, 200);
    assert.equal(write.body.error.code, -32000);
    assert.match(write.body.error.message, /maintenance: Moving house/);
  } finally {
    await toggle(false);
    await pool.query("DELETE FROM system_settings WHERE key = 'maintenance'");
    invalidateSettings();
  }
});

test("expired and suspended connections are refused", async () => {
  const expiring = await h.agentKey(me);
  await pool.query(
    "UPDATE agent_grants SET expires_at = now() - interval '1 second' WHERE id = $1",
    [expiring.id],
  );
  const expired = await h.legacy(expiring.key, "ping");
  assert.equal(expired.status, 401);
  assert.match(expired.body.error.message, /expired/);
  const suspended = await h.agentKey(me);
  await pool.query(
    "UPDATE agent_grants SET suspended_at = now() WHERE id = $1",
    [suspended.id],
  );
  const r = await h.legacy(suspended.key, "ping");
  assert.equal(r.status, 403);
  assert.match(r.body.error.message, /suspended/);
  const live = await h.agentKey(me);
  await pool.query("UPDATE users SET disabled = true WHERE id = $1", [me.id]);
  try {
    const disabled = await h.legacy(live.key, "ping");
    assert.equal(disabled.status, 403);
    assert.match(disabled.body.error.message, /disabled/);
  } finally {
    await pool.query("UPDATE users SET disabled = false WHERE id = $1", [
      me.id,
    ]);
  }
  assert.equal((await h.legacy(live.key, "ping")).status, 200);
});

test("a connection that keeps going over its limits, or keeps probing, is paused until its person restores it", async () => {
  const pausedOf = async (id: string) =>
    (
      await pool.query<{ suspended_at: Date | null }>(
        "SELECT suspended_at FROM agent_grants WHERE id = $1",
        [id],
      )
    ).rows[0].suspended_at;
  /** Pausing happens off the request path: wait for it (2 s at most). */
  const waitPaused = async (id: string) => {
    for (let i = 0; i < 40 && !(await pausedOf(id)); i++)
      await new Promise((r) => setTimeout(r, 50));
    return pausedOf(id);
  };

  const noisy = await h.agentKey(me, { name: "Noisy" });
  limiter.reset();
  strikes.reset();
  await setting("agent_limits", { calls_per_minute: 1 });
  try {
    assert.equal((await h.legacy(noisy.key, "ping")).status, 200);
    // Five times over the limit is only refused; the sixth pauses it.
    for (let i = 0; i < 6; i++)
      assert.equal((await h.legacy(noisy.key, "ping")).status, 429);
    assert.ok(await waitPaused(noisy.id));
  } finally {
    await clear("agent_limits");
    limiter.reset();
  }
  const refused = await h.legacy(noisy.key, "ping");
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /suspended/);
  const listed = (await h.call(me.token, "GET", "/me/agents"))
    .json()
    .grants.find((g: { id: string }) => g.id === noisy.id);
  assert.ok(listed.suspended_at);
  const paused = await pool.query(
    "SELECT actor_id, details FROM audit_log WHERE action = 'agent_grant.suspended' AND target_id = $1",
    [noisy.id],
  );
  assert.equal(paused.rows[0].actor_id, null);
  assert.equal(paused.rows[0].details.reason, "rate_limit");

  // Only its person restores it, signed in.
  const stranger = await h.register("agents-restorer");
  assert.equal(
    (await h.call(null, "POST", `/me/agents/${noisy.id}/restore`)).statusCode,
    401,
  );
  assert.equal(
    (await h.call(apiKey, "POST", `/me/agents/${noisy.id}/restore`)).statusCode,
    403,
  );
  assert.equal(
    (await h.call(stranger.token, "POST", `/me/agents/${noisy.id}/restore`))
      .statusCode,
    404,
  );
  assert.equal(
    (await h.call(noisy.key, "POST", `/me/agents/${noisy.id}/restore`))
      .statusCode,
    401,
  );
  const restored = await h.call(
    me.token,
    "POST",
    `/me/agents/${noisy.id}/restore`,
  );
  assert.equal(restored.statusCode, 204);
  assert.equal(await pausedOf(noisy.id), null);
  assert.equal((await h.legacy(noisy.key, "ping")).status, 200);
  const back = await pool.query(
    "SELECT request_id FROM audit_log WHERE action = 'agent_grant.restored' AND target_id = $1",
    [noisy.id],
  );
  assert.ok(back.rows[0].request_id);

  // Asking again and again for what it can't reach looks like probing.
  const prober = await h.agentKey(me, { name: "Prober" });
  strikes.reset();
  for (let i = 0; i < 51; i++) {
    const r = await h.tool(prober.key, "fetch", {
      id: `task:00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    });
    assert.equal(r?.isError, true);
  }
  assert.ok(await waitPaused(prober.id));
  const why = await pool.query(
    "SELECT details FROM audit_log WHERE action = 'agent_grant.suspended' AND target_id = $1",
    [prober.id],
  );
  assert.equal(why.rows[0].details.reason, "probing");
  limiter.reset();
  strikes.reset();
});

test("agent keys can hide outside content; creating and revoking record the request", async () => {
  const made = await h.call(me.token, "POST", "/me/agent-keys", {
    name: "Careful",
    hide_outside_content: true,
  });
  assert.equal(made.statusCode, 201, made.body);
  const { grant, key } = made.json();
  assert.equal(grant.hide_outside_content, true);
  assert.equal(grant.suspended_at, null);
  const ctx = await h.tool(key, "get_context");
  assert.equal(
    ctx!.structuredContent.connection.flags.hide_outside_content,
    true,
  );
  const created = await pool.query(
    "SELECT request_id FROM audit_log WHERE action = 'agent_key.created' AND target_id = $1",
    [grant.id],
  );
  assert.ok(created.rows[0].request_id);
  assert.equal(
    (
      await h.call(me.token, "POST", "/me/agent-keys", {
        name: "x",
        hide_outside_content: "yes",
      })
    ).statusCode,
    422,
  );
});

test("the sweeper clears old agent activity, usage and long-expired credentials", async () => {
  const { id } = await h.agentKey(me, { name: "Old" });
  await pool.query(
    `INSERT INTO agent_activity (at, user_id, grant_id, tool, outcome, summary)
     VALUES (now() - interval '200 days', $1, $2, 'search', 'ok', 'Very old'),
            (now() - interval '1 day', $1, $2, 'search', 'ok', 'Recent')`,
    [me.id, id],
  );
  await pool.query(
    `INSERT INTO agent_usage_daily (day, grant_id, calls)
     VALUES (current_date - 120, $1, 5), (current_date, $1, 1)
     ON CONFLICT (day, grant_id) DO NOTHING`,
    [id],
  );
  await pool.query(
    "UPDATE agent_tokens SET expires_at = now() - interval '40 days' WHERE grant_id = $1",
    [id],
  );
  await pool.query(
    `INSERT INTO mcp_request_state (id, grant_id, kind, expires_at)
     VALUES ('seal-old-' || gen_random_uuid(), $1, 'plan', now() - interval '1 minute')`,
    [id],
  );
  const result = await runSweep();
  assert.ok(result, "another sweep was running");
  assert.equal(result.errors.agent_activity, undefined);
  const left = await pool.query(
    "SELECT summary FROM agent_activity WHERE grant_id = $1 ORDER BY at",
    [id],
  );
  assert.deepEqual(
    left.rows.map((r) => r.summary),
    ["Recent"],
  );
  const usage = await pool.query(
    "SELECT count(*)::int AS n FROM agent_usage_daily WHERE grant_id = $1",
    [id],
  );
  assert.equal(usage.rows[0].n, 1);
  for (const table of ["agent_tokens", "mcp_request_state"])
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE grant_id = $1`,
          [id],
        )
      ).rows[0].n,
      0,
      table,
    );
  // The connection itself stays: timelines name the agent through it.
  assert.equal(
    (await pool.query("SELECT 1 FROM agent_grants WHERE id = $1", [id]))
      .rowCount,
    1,
  );
});

test("a made-up agent credential counts against its address: sign-in limits still hold", async () => {
  const { randomBytes } = await import("node:crypto");
  const fresh = (prefix: string) =>
    `${prefix}${randomBytes(32).toString("base64url")}`;
  let n = 0;
  for (const prefix of ["oak_", "oat_", "ort_", "ok_"]) {
    // One address, a different random credential on every attempt.
    const address = `10.55.1.${++n}`;
    const codes: number[] = [];
    for (let i = 0; i < 15; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/auth/login",
        remoteAddress: address,
        headers: { authorization: `Bearer ${fresh(prefix)}` },
        payload: {
          email: `nobody-${prefix}@example.com`,
          password: "not-the-password",
        },
      });
      codes.push(r.statusCode);
    }
    assert.ok(
      codes.slice(0, 10).every((c) => c !== 429),
      `${prefix}: ${codes.join(",")}`,
    );
    assert.ok(
      codes.slice(10).every((c) => c === 429),
      `${prefix}: ${codes.join(",")}`,
    );
  }
});

test("the general limit counts a real agent key against its connection, only at the MCP address", async () => {
  const { agentLimitKey } = await import("../src/lib/auth.js");
  const { key, id } = await h.agentKey(me);
  const req = (url: string, token: string) =>
    ({ url, headers: { authorization: `Bearer ${token}` } }) as never;
  assert.equal(await agentLimitKey(req("/mcp", key)), `agent:${id}`);
  assert.equal(
    await agentLimitKey(req("/.well-known/oauth-protected-resource/mcp", key)),
    `agent:${id}`,
  );
  // Anywhere else, or a key nobody made: per address, like everyone.
  assert.equal(await agentLimitKey(req("/auth/login", key)), null);
  assert.equal(await agentLimitKey(req("/items", key)), null);
  assert.equal(await agentLimitKey(req("/mcp", `oak_${"x".repeat(43)}`)), null);
  assert.equal(await agentLimitKey(req("/mcp", apiKey)), null);
});

test("a personal API key can't change what agents reach in a team", async () => {
  const r = await h.call(apiKey, "PUT", `/teams/${teamId}/agent-access`, {
    agent_access: "role",
  });
  assert.equal(r.statusCode, 403, r.body);
  assert.match(r.json().message, /outside agents/);
  const { keyBlockedRoute } = await import("../src/lib/auth.js");
  for (const [method, route] of [
    ["PUT", "/teams/:id/agent-access"],
    ["POST", "/me/agent-keys"],
    ["GET", "/me/agents"],
    ["DELETE", "/me/agents/:id"],
    ["POST", "/me/agents/:id/restore"],
  ])
    assert.ok(keyBlockedRoute(method, route), `${method} ${route}`);
  // The owner, signed in, still can.
  assert.equal(
    (
      await h.call(me.token, "PUT", `/teams/${teamId}/agent-access`, {
        agent_access: "role",
      })
    ).statusCode,
    200,
  );
});

test("deleting a personal API key ends its legacy connection but keeps it and what it did", async () => {
  const made = (
    await h.call(me.token, "POST", "/me/api-keys", { name: "Retiring script" })
  ).json();
  assert.equal((await h.legacy(made.key, "ping")).status, 200);
  const grant = (
    await pool.query<{ id: string }>(
      "SELECT id FROM agent_grants WHERE api_key_id = $1",
      [made.id],
    )
  ).rows[0];
  assert.ok(grant, "the legacy connection was made");
  await pool.query(
    `INSERT INTO agent_activity (user_id, grant_id, tool, outcome, summary)
     VALUES ($1, $2, 'search', 'ok', 'Kept after the key went')`,
    [me.id, grant.id],
  );
  assert.equal(
    (await h.call(me.token, "DELETE", `/me/api-keys/${made.id}`)).statusCode,
    204,
  );
  const after = (
    await pool.query(
      "SELECT revoked_at, api_key_id FROM agent_grants WHERE id = $1",
      [grant.id],
    )
  ).rows[0];
  assert.ok(after, "the connection is kept");
  assert.ok(after.revoked_at, "and ended");
  assert.equal(after.api_key_id, null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agent_activity WHERE grant_id = $1",
        [grant.id],
      )
    ).rows[0].n,
    1,
  );
  const listed = (await h.call(me.token, "GET", "/me/agents")).json().grants;
  assert.ok(!listed.some((g: { id: string }) => g.id === grant.id));
});

test("expired connections don't count against the limit, and leave the list a month after", async () => {
  const { MAX_GRANTS } = await import("../src/modules/agents/service.js");
  const someone = await h.register("agents-many", "Many");
  const ids: string[] = [];
  for (let i = 0; i < MAX_GRANTS; i++)
    ids.push((await h.agentKey(someone, { name: `Key ${i}` })).id);
  await assert.rejects(h.agentKey(someone), /up to 50 connected agents/);
  // Expired ones make room.
  await pool.query(
    "UPDATE agent_grants SET expires_at = now() - interval '1 day' WHERE id = ANY ($1::uuid[])",
    [ids.slice(0, 2)],
  );
  await h.agentKey(someone, { name: "After expiry" });
  let listed = (await h.call(someone.token, "GET", "/me/agents")).json()
    .grants as { id: string }[];
  assert.ok(
    listed.some((g) => g.id === ids[0]),
    "shown as expired for now",
  );
  await pool.query(
    "UPDATE agent_grants SET expires_at = now() - interval '31 days' WHERE id = $1",
    [ids[0]],
  );
  listed = (await h.call(someone.token, "GET", "/me/agents")).json().grants;
  assert.ok(!listed.some((g) => g.id === ids[0]));
});

test("leaving a team takes it off agent keys; joining again doesn't give it back", async () => {
  const joiner = await h.register("agents-joiner", "Jo");
  await h.call(me.token, "POST", `/teams/${teamId}/members`, {
    email: joiner.email,
    role: "member",
  });
  const { id } = await h.agentKey(joiner, { team_ids: [teamId] });
  await h.call(me.token, "DELETE", `/teams/${teamId}/members/${joiner.id}`);
  const teams = async () =>
    (
      await pool.query<{ team_ids: string[] }>(
        "SELECT team_ids FROM agent_grants WHERE id = $1",
        [id],
      )
    ).rows[0].team_ids;
  assert.deepEqual(await teams(), []);
  await h.call(me.token, "POST", `/teams/${teamId}/members`, {
    email: joiner.email,
    role: "member",
  });
  assert.deepEqual(await teams(), []);
});

test("the request log names known tools and methods only, never text a caller chose", async () => {
  const { routeLabel } = await import("../src/modules/mcp-server/routes.js");
  assert.equal(routeLabel("tools/call", "search", "search"), "mcp:search");
  assert.equal(
    routeLabel("tools/call", "x".repeat(100_000), undefined),
    "mcp:unknown-tool",
  );
  assert.equal(routeLabel("tools/call", null, undefined), "mcp:tools/call");
  assert.equal(
    routeLabel("resources/read", null, undefined),
    "mcp:resources/read",
  );
  assert.equal(
    routeLabel(`made/up/${"y".repeat(500)}`, null, undefined),
    "mcp:other",
  );
});
