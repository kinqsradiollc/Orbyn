import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import {
  pluginResources,
  readPluginResource,
  pluginResourceInput,
  pluginToolUiMeta,
  pluginEntrypointResult,
  PLUGIN_ENTRYPOINT,
  PLUGIN_MARKDOWN_FILE,
  pluginMarkdownFileInput,
  pluginMarkdownFileResult,
} from "../src/modules/plugin/ui-resources.js";

test("plugin sidebar opens without reading account data", () => {
  assert.deepEqual(pluginToolUiMeta(PLUGIN_ENTRYPOINT)?.["openai/ui"], {
    entrypoints: [{ type: "global" }],
  });
  assert.equal(pluginToolUiMeta("get_today")?.["openai/ui"], undefined);
  assert.deepEqual(pluginEntrypointResult({}).structuredContent, {
    kind: "plugin_home",
  });
  assert.equal(pluginToolUiMeta("unknown_tool"), null);
  assert.equal(pluginToolUiMeta("plan_schedule")?.["openai/ui"], undefined);
});

test("plugin Markdown file entrypoint uses host resources without returning file data", () => {
  assert.deepEqual(pluginToolUiMeta(PLUGIN_MARKDOWN_FILE)?.["openai/ui"], {
    entrypoints: [{ type: "file", extensions: [".md", ".markdown"] }],
  });
  assert.deepEqual(pluginToolUiMeta(PLUGIN_MARKDOWN_FILE)?.ui, {
    resourceUri: "ui://orbyn/markdown-file.html",
    visibility: ["model", "app"],
  });
  assert.equal(
    pluginMarkdownFileInput.safeParse({
      file: { name: "notes.md", resourceUri: "host-resource://opaque" },
    }).success,
    true,
  );
  for (const file of [
    { name: "../private.md", resourceUri: "host-resource://opaque" },
    { name: "notes.txt", resourceUri: "host-resource://opaque" },
    { name: "notes.md", resourceUri: "" },
    { name: "notes.md", resourceUri: "host-resource://opaque", path: "/tmp/x" },
  ])
    assert.equal(pluginMarkdownFileInput.safeParse({ file }).success, false);
  assert.deepEqual(pluginMarkdownFileResult().structuredContent, {
    kind: "markdown_file",
  });
  const [resource] = pluginResources([PLUGIN_MARKDOWN_FILE], true);
  assert.equal(resource.uri, "ui://orbyn/markdown-file.html");
  const html = readPluginResource(resource.uri, [PLUGIN_MARKDOWN_FILE], true)!
    .contents[0].text;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.match(script, /resources\/read/);
  assert.match(script, /openai\/resources\/write/);
  assert.doesNotMatch(
    html,
    /<script[^>]+src=|<iframe|fetch\(|document\.cookie/,
  );
  assert.equal(readPluginResource(resource.uri, ["get_today"], true), null);
});

test("Markdown app reads a host file and saves only after a user edit", async () => {
  const [resource] = pluginResources([PLUGIN_MARKDOWN_FILE], true);
  const html = readPluginResource(resource.uri, [PLUGIN_MARKDOWN_FILE], true)!
    .contents[0].text;
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const elements = new Map<string, any>();
  for (const id of [
    "file-name",
    "mode",
    "file-status",
    "source",
    "save",
    "reload",
  ])
    elements.set(id, {
      textContent: "",
      value: "",
      hidden: false,
      disabled: false,
      readOnly: false,
      addEventListener(name: string, listener: () => void) {
        this[name] = listener;
      },
    });
  const listeners = new Map<string, (event: any) => void>();
  const sent: any[] = [];
  const parent = { postMessage: (message: any) => sent.push(message) };
  const window = {
    parent,
    addEventListener: (name: string, listener: (event: any) => void) =>
      listeners.set(name, listener),
  };
  new Script(script).runInNewContext({
    window,
    document: {
      getElementById: (id: string) => elements.get(id),
      documentElement: { scrollHeight: 400, dataset: {} },
    },
    Uint8Array,
    TextDecoder,
  });
  const deliver = (method: string, params: unknown) =>
    listeners.get("message")!({
      source: parent,
      data: { jsonrpc: "2.0", method, params },
    });
  const respond = (id: number, result: unknown) =>
    listeners.get("message")!({
      source: parent,
      data: { jsonrpc: "2.0", id, result },
    });
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const request = (method: string) => sent.findLast((m) => m.method === method);
  const uri = "host-resource://opaque";
  deliver("ui/notifications/tool-input", {
    arguments: { file: { name: "notes.md", resourceUri: uri } },
  });
  const read = request("resources/read");
  assert.equal(read.params.uri, uri);
  assert.equal(
    sent.some((m) => JSON.stringify(m).includes("private note")),
    false,
  );
  respond(read.id, {
    contents: [
      {
        uri,
        text: "private note",
        _meta: { "openai/resource": { writable: true, etag: "v1" } },
      },
    ],
  });
  await flush();
  const source = elements.get("source");
  assert.equal(source.value, "private note");
  assert.equal(source.readOnly, false);
  assert.equal(elements.get("save").disabled, true);
  source.value = "revised note";
  source.input();
  const readCount = sent.filter((m) => m.method === "resources/read").length;
  deliver("ui/notifications/tool-input", {
    arguments: { file: { name: "notes.md", resourceUri: uri } },
  });
  assert.equal(source.value, "revised note");
  assert.equal(
    sent.filter((m) => m.method === "resources/read").length,
    readCount,
  );
  elements.get("save").onclick();
  const write = request("openai/resources/write");
  assert.deepEqual(JSON.parse(JSON.stringify(write.params)), {
    uri,
    text: "revised note",
    ifMatch: "v1",
  });
  source.value = "newer unsaved edit";
  source.input();
  assert.equal(elements.get("save").disabled, true);
  assert.equal(elements.get("reload").disabled, true);
  elements.get("save").onclick();
  elements.get("reload").onclick();
  deliver("notifications/resources/updated", { uri });
  assert.equal(
    sent.filter((m) => m.method === "openai/resources/write").length,
    1,
  );
  assert.equal(sent.filter((m) => m.method === "resources/read").length, 1);
  respond(write.id, { outcome: "saved", etag: "v2" });
  await flush();
  assert.equal(elements.get("file-status").textContent, "Unsaved changes");
  assert.equal(source.value, "newer unsaved edit");
  assert.equal(elements.get("save").disabled, false);
  assert.equal(elements.get("reload").disabled, false);
  source.value = "another edit";
  source.input();
  elements.get("save").onclick();
  respond(request("openai/resources/write").id, {
    outcome: "conflict",
    etag: "v3",
  });
  await flush();
  assert.match(elements.get("file-status").textContent, /changed elsewhere/);
  assert.equal(elements.get("save").disabled, true);
  assert.equal(source.value, "another edit");
  deliver("ui/notifications/tool-input", {
    arguments: {
      file: { name: "other.md", resourceUri: "host-resource://other" },
    },
  });
  assert.equal(source.value, "");
  assert.equal(elements.get("save").hidden, true);
  respond(request("resources/read").id, { contents: [] });
  await flush();
  assert.equal(source.value, "");
  assert.equal(elements.get("mode").textContent, "Unavailable");
  assert.equal(elements.get("reload").hidden, false);
});

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
  assert.match(result.contents[0].text, /Load today/);
  assert.match(result.contents[0].text, /load\.onclick=async/);
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
