import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectorResources,
  selectConnectorResource,
  ResourceTargetError,
} from "../src/modules/oauth/resources.js";
const config = {
  mcp: "https://mcp.example.test/mcp",
  plugin: "https://plugin.example.test/plugin",
};

test("portable MCP keeps its canonical resource and historical origin alias", () => {
  for (const requested of [
    undefined,
    "",
    config.mcp,
    `${config.mcp}/`,
    "https://mcp.example.test",
  ])
    assert.deepEqual(selectConnectorResource(requested, config), {
      kind: "mcp",
      resource: config.mcp,
    });
});
test("plugin authorization is explicit and its refresh binding survives omission", () => {
  assert.deepEqual(selectConnectorResource(config.plugin, config), {
    kind: "plugin",
    resource: config.plugin,
  });
  assert.deepEqual(selectConnectorResource(undefined, config, config.plugin), {
    kind: "plugin",
    resource: config.plugin,
  });
  assert.deepEqual(
    selectConnectorResource(`${config.plugin}/`, config, config.plugin),
    { kind: "plugin", resource: config.plugin },
  );
  assert.throws(
    () => selectConnectorResource("https://plugin.example.test", config),
    ResourceTargetError,
  );
});
test("code and refresh resources cannot cross the plugin and MCP boundary", () => {
  assert.throws(
    () => selectConnectorResource(config.mcp, config, config.plugin),
    ResourceTargetError,
  );
  assert.throws(
    () => selectConnectorResource(config.plugin, config, config.mcp),
    ResourceTargetError,
  );
  assert.throws(
    () =>
      selectConnectorResource(
        undefined,
        config,
        "https://other.example.test/plugin",
      ),
    ResourceTargetError,
  );
  assert.throws(
    () => selectConnectorResource(config.plugin, { mcp: config.mcp }),
    ResourceTargetError,
  );
});
test("untrusted URLs and conflicting recipients fail with static diagnostics", () => {
  for (const requested of [
    "https://mcp.example.test/mcp-other",
    "https://plugin.example.test/plugin?token=secret",
    "https://name:secret@plugin.example.test/plugin",
    "https://plugin.example.test/plugin#secret",
    "http://plugin.example.test/plugin",
    "file:///plugin",
    "not a URL",
  ]) {
    assert.throws(
      () => selectConnectorResource(requested, config),
      (error: unknown) =>
        error instanceof ResourceTargetError &&
        !error.message.includes("secret"),
    );
  }
  assert.throws(
    () => connectorResources({ mcp: config.mcp, plugin: config.mcp }),
    ResourceTargetError,
  );
  assert.throws(
    () =>
      connectorResources({
        mcp: config.mcp,
        plugin: "https://mcp.example.test",
      }),
    ResourceTargetError,
  );
});
test("local development accepts loopback HTTP while retaining distinct paths", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const local = {
      mcp: `http://${host}:8000/mcp`,
      plugin: `http://${host}:8000/plugin`,
    };
    assert.equal(selectConnectorResource(local.plugin, local).kind, "plugin");
    assert.equal(selectConnectorResource(undefined, local).kind, "mcp");
  }
});
