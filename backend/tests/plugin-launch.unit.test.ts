import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pluginLaunch,
  pluginLaunchInput,
} from "../src/modules/plugin/launch.js";
import { pluginResources } from "../src/modules/plugin/ui-resources.js";
import type { Principal } from "../src/capabilities/policy.js";

const principal = (): Principal => ({
  user: { id: "owner", name: "Owner", role: "member" },
  via: "plugin",
  grant_id: "grant",
  client: { id: "client", name: "Client" },
  access: "read",
  team_ids: [],
  personal: true,
  toolsets: ["core"],
  flags: {
    notify_teammates: false,
    hide_outside_content: false,
    readonly: true,
  },
  trust: { level: "ask", spaces: {}, acts_alone: [] },
  teams: [],
});

test("launch accepts bounded presentation hints without altering the connection", () => {
  const context = pluginLaunchInput.parse({
    version: 1,
    presentation: { theme: "dark", locale: "zh-Hant-TW" },
  });
  const p = principal();
  const before = structuredClone(p);
  const result = pluginLaunch(p, context, ["get_today"], true);
  assert.deepEqual(result.connection, {
    kind: "plugin",
    user_id: "owner",
    grant_id: "grant",
    client_id: "client",
  });
  assert.deepEqual(result.presentation, context.presentation);
  assert.deepEqual(p, before);
  assert.equal(result.resources.length, 1);
  assert.equal("selected_resource" in result, false);
});

test("launch rejects host-provided authority, credentials, URLs and unsupported versions", () => {
  for (const input of [
    null,
    {},
    { version: 2 },
    ...[
      "user_id",
      "grant_id",
      "client_id",
      "provider",
      "access_token",
      "callback_url",
      "tools",
    ].map((field) => ({ version: 1, [field]: "host-value" })),
    { version: 1, presentation: { user_id: "other" } },
    { version: 1, presentation: { theme: "anything" } },
    { version: 1, presentation: { locale: "<script>" } },
    { version: 1, presentation: { locale: "en-" + "a".repeat(64) } },
    { version: 1, resource_uri: "x".repeat(257) },
  ])
    assert.equal(pluginLaunchInput.safeParse(input).success, false);
});

test("launch never accepts a first-party or portable MCP principal", () => {
  for (const via of [
    "session",
    "oauth",
    "assistant",
    "agent_key",
    "legacy_key",
  ] as const)
    assert.throws(
      () => pluginLaunch({ ...principal(), via }, { version: 1 }, [], false),
      /plugin connection/,
    );
  for (const p of [
    { ...principal(), grant_id: null },
    { ...principal(), client: { id: null, name: "Host" } },
  ])
    assert.throws(
      () => pluginLaunch(p, { version: 1 }, [], false),
      /plugin connection/,
    );
});

test("launch selection requires current tool permission and UI consent", () => {
  const [card] = pluginResources(["get_today"], true);
  const input = { version: 1 as const, resource_uri: card.uri };
  assert.equal(
    pluginLaunch(principal(), input, ["get_today"], true).selected_resource,
    card.uri,
  );
  assert.throws(
    () => pluginLaunch(principal(), input, [], true),
    /not available/,
  );
  assert.throws(
    () => pluginLaunch(principal(), input, ["get_today"], false),
    /not available/,
  );
  assert.deepEqual(
    pluginLaunch(principal(), { version: 1 }, ["get_today"], false).resources,
    [],
  );
});

test("launch cannot select arbitrary network, file or job addresses", () => {
  for (const resource_uri of [
    "https://internal.test/secret",
    "file:///etc/passwd",
    "orbyn://plugin-job/other",
    "ui://unknown",
  ])
    assert.throws(
      () =>
        pluginLaunch(
          principal(),
          { version: 1, resource_uri },
          ["get_today"],
          true,
        ),
      /not available/,
    );
});

test("launch identity changes with the authenticated account rather than host hints", () => {
  const other = {
    ...principal(),
    user: { ...principal().user, id: "other" },
    grant_id: "other-grant",
  };
  assert.equal(
    pluginLaunch(other, { version: 1 }, [], false).connection.user_id,
    "other",
  );
  assert.equal(
    pluginLaunch(principal(), { version: 1 }, [], false).connection.user_id,
    "owner",
  );
});
