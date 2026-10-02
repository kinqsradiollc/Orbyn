import "./setup.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AGENT_SETTINGS } from "@orbyn/core";
import { pool } from "../src/db/pool.js";
import { digest } from "../src/lib/auth.js";
import type { LiveSettings } from "../src/lib/settings.js";
import type { GrantRow } from "../src/capabilities/connector-principal.js";
import {
  PluginAuthError,
  resolvePluginCaller,
} from "../src/modules/plugin/auth.js";

const resources = {
  mcp: "https://mcp.example.test/mcp",
  plugin: "https://plugin.example.test/api",
};
const settings = {
  agents: { ...DEFAULT_AGENT_SETTINGS, agents_enabled: true },
} as LiveSettings;
const token = "oat_test-only-plugin-access";
const grant = (): GrantRow => ({
  resource_kind: "plugin",
  grant_id: "grant",
  kind: "oauth",
  client_id: "client",
  client_name: "Fixture",
  name: "Fixture",
  access: "write",
  team_ids: ["allowed"],
  personal: false,
  toolsets: ["core"],
  flags: {},
  trust: "ask",
  space_trust: null,
  acts_alone: null,
  client_blocked: false,
  client_host: "fixture.example.test",
  client_kind: "dcr",
  client_redirect_uris: ["https://fixture.example.test/callback"],
  expires_at: null,
  token_expires_at: new Date(Date.now() + 60_000),
  resource: resources.plugin,
  last_write_at: null,
  suspended_at: null,
  revoked_at: null,
  user_id: "person",
  user_name: "Fixture",
  disabled: false,
});
const originalQuery = pool.query;
after(async () => {
  pool.query = originalQuery;
  await pool.end();
});

async function withRow(row: GrantRow | undefined, run: () => Promise<void>) {
  pool.query = (async (sql: string, values: unknown[]) => {
    if (sql.includes("FROM agent_tokens")) {
      assert.deepEqual(values, [digest(token)]);
      return { rows: row ? [row] : [] };
    }
    assert.deepEqual(values, ["person", ["allowed"]]);
    return {
      rows: [
        {
          id: "allowed",
          name: "Allowed",
          role: "viewer",
          agent_access: "read",
        },
        { id: "off", name: "Off", role: "owner", agent_access: "off" },
      ],
    };
  }) as typeof pool.query;
  try {
    await run();
  } finally {
    pool.query = originalQuery;
  }
}
const refused = (status: number) => (error: unknown) => {
  assert.ok(error instanceof PluginAuthError);
  assert.equal(error.status, status);
  assert.equal("challenge" in error, false);
  return true;
};
const call = (s = settings, r = resources) =>
  resolvePluginCaller(
    {
      authorization: `Bearer ${token}`,
      "x-mcp-toolsets": "admin",
      "x-mcp-readonly": "true",
    },
    s,
    r,
  );

test("plugin authentication rejects sessions, API keys, agent keys and refresh credentials before lookup", async () => {
  pool.query = (() => {
    throw new Error("Credential must not reach database");
  }) as typeof pool.query;
  try {
    for (const credential of [
      "session-fixture",
      "ok_fixture",
      "oak_fixture",
      "ort_fixture",
      "",
    ])
      await assert.rejects(
        resolvePluginCaller(
          { authorization: `Bearer ${credential}` },
          settings,
          resources,
        ),
        refused(401),
      );
    await assert.rejects(
      call(settings, { ...resources, plugin: "" }),
      refused(403),
    );
    await assert.rejects(
      call({
        ...settings,
        agents: { ...settings.agents, agents_enabled: false },
      }),
      refused(403),
    );
  } finally {
    pool.query = originalQuery;
  }
});

test("plugin principal uses current grant and reachable team policy without session privileges or host permission headers", async () => {
  await withRow(grant(), async () => {
    const result = await call();
    assert.equal(result.principal.via, "plugin");
    assert.equal(result.principal.user.role, "member");
    assert.equal(result.principal.personal, false);
    assert.deepEqual(result.principal.toolsets, ["core"]);
    assert.equal(result.principal.flags.readonly, false);
    assert.deepEqual(
      result.principal.teams.map((t) => t.id),
      ["allowed"],
    );
    assert.equal(result.principal.trust.level, "ask");
  });
});

test("wrong recipient, grant type, missing binding, unknown or expired credentials are unauthorized", async () => {
  for (const patch of [
    { resource_kind: "mcp" },
    { kind: "key" },
    { resource: resources.mcp },
    { resource: null },
    { client_id: null },
    { token_expires_at: null },
    { token_expires_at: new Date(0) },
    { expires_at: new Date(0) },
    { revoked_at: new Date() },
  ] as Partial<GrantRow>[])
    await withRow({ ...grant(), ...patch }, async () => {
      await assert.rejects(call(), refused(401));
    });
  await withRow(undefined, async () => {
    await assert.rejects(call(), refused(401));
  });
});

test("disabled person, suspended grant, deleted or blocked client and current host policy are forbidden", async () => {
  for (const patch of [
    { disabled: true },
    { suspended_at: new Date() },
    { client_blocked: true },
    { client_kind: null },
  ])
    await withRow({ ...grant(), ...patch }, async () => {
      await assert.rejects(call(), refused(403));
    });
  await withRow(grant(), async () => {
    await assert.rejects(
      call({
        ...settings,
        agents: { ...settings.agents, blocked_client_ids: ["client"] },
      }),
      refused(403),
    );
    await assert.rejects(
      call({
        ...settings,
        agents: {
          ...settings.agents,
          allowed_client_hosts: ["another.example.test"],
        },
      }),
      refused(403),
    );
  });
});
