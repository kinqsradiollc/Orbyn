import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pluginResources,
  readPluginResource,
  pluginResourceInput,
} from "../src/modules/plugin/ui-resources.js";

test("plugin cards are opt-in and limited to the current allowed tools", () => {
  assert.deepEqual(pluginResources(["get_today"], false), []);
  assert.deepEqual(pluginResources([], true), []);
  assert.deepEqual(pluginResources(["unknown_tool"], true), []);
  const today = pluginResources(["get_today"], true);
  assert.equal(today.length, 1);
  assert.equal(pluginResources(["get_today", "get_today"], true).length, 1);
  assert.ok(today[0].uri.startsWith("ui://"));
});
test("plugin resource reads recheck opt-in and tool scope", () => {
  const [today] = pluginResources(["get_today"], true);
  assert.ok(readPluginResource(today.uri, ["get_today"], true));
  assert.equal(readPluginResource(today.uri, [], true), null);
  assert.equal(readPluginResource(today.uri, ["get_today"], false), null);
  for (const uri of [
    "https://private.example.test/secret",
    "file:///etc/passwd",
    `${today.uri}?secret=1`,
    "ui://unknown",
  ])
    assert.equal(readPluginResource(uri, ["get_today"], true), null);
});
test("plugin resources declare isolated first-party HTML with no external domains", () => {
  const [today] = pluginResources(["get_today"], true);
  const result = readPluginResource(today.uri, ["get_today"], true)!;
  assert.equal(result.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(result.contents[0]._meta.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
  });
  assert.match(result.contents[0].text, /ui\/initialize/);
  assert.doesNotMatch(
    result.contents[0].text,
    /<script[^>]+src=|<iframe|fetch\(|localStorage|sessionStorage|document\.cookie/,
  );
});
test("plugin resource inputs are bounded and reject host authority fields", () => {
  assert.deepEqual(pluginResourceInput.parse({ uri: "ui://orbyn/card" }), {
    uri: "ui://orbyn/card",
  });
  for (const input of [
    null,
    {},
    { uri: "" },
    { uri: "x".repeat(257) },
    { uri: "ui://orbyn/card", user_id: "another" },
  ])
    assert.equal(pluginResourceInput.safeParse(input).success, false);
});
