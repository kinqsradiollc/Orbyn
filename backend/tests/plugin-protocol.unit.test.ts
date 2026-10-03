import { test } from "node:test";
import assert from "node:assert/strict";
import { servePluginProtocol } from "../src/modules/plugin/protocol.js";
import { PluginCallError } from "../src/modules/plugin/dispatch.js";
import {
  parsePluginJobUri,
  pluginJobUri,
} from "../src/modules/plugin/job-resource.js";

const tools = [
  {
    name: "get_today",
    title: "Today",
    description: "Read the day.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];
async function rpc(
  method: string,
  params?: object,
  options: {
    ui?: boolean;
    modern?: boolean;
    invoke?: (name: string, args: Record<string, unknown>) => Promise<any>;
    tools?: typeof tools;
    readJob?: (id: string, cursor?: string) => Promise<any>;
  } = {},
) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    ...(options.modern
      ? { params: { ...params, _meta: meta } }
      : params
        ? { params }
        : {}),
  };
  const request = new Request("http://plugin.local/plugin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(options.modern
        ? {
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": method,
            ...(method === "tools/call"
              ? { "mcp-name": (params as { name: string }).name }
              : {}),
            ...(method === "resources/read"
              ? { "mcp-name": (params as { uri: string }).uri }
              : {}),
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await servePluginProtocol(
    {
      grantId: "fixture-grant",
      clientId: "fixture-client",
      tools: options.tools ?? tools,
      uiEnabled: options.ui ?? false,
      invoke:
        options.invoke ??
        (async () => ({ content: [{ type: "text", text: "Fixture" }] })),
      readJob: options.readJob,
    },
    request,
    body,
  );
  const text = await response.text();
  const json = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? JSON.parse(
        text
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      )
    : JSON.parse(text);
  return { response, json };
}
test("plugin protocol initializes statelessly and lists only adapter-authorized tools", async () => {
  const init = await rpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  });
  assert.equal(init.response.status, 200);
  assert.equal(init.json.result.serverInfo.name, "orbyn-plugin");
  assert.equal(init.response.headers.get("mcp-session-id"), null);
  const list = await rpc("tools/list");
  assert.deepEqual(
    list.json.result.tools.map((tool: any) => tool.name),
    ["get_today"],
  );
});

test("plugin import resources use bounded server addresses and reject identity or URL injection", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parsePluginJobUri(pluginJobUri(id)), { id });
  assert.deepEqual(
    parsePluginJobUri(pluginJobUri(id) + "?cursor=pj1.fixture"),
    { id, cursor: "pj1.fixture" },
  );
  for (const uri of [
    "https://example.test/private",
    pluginJobUri(id) + "?grant=other",
    pluginJobUri(id) + "?cursor=a&cursor=b",
    pluginJobUri(id) + "#private",
    pluginJobUri(id) + "?cursor=" + "a".repeat(513),
    "orbyn://user:pass@plugin-job/" + id,
  ])
    assert.equal(parsePluginJobUri(uri), null);
});
test("modern plugin clients read authorized async import pages without enabling UI cards", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const calls: unknown[] = [];
  const page = {
    id,
    status: "waiting",
    events: [],
    cursor: "fixture-next",
    has_more: false,
  };
  const result = await rpc(
    "resources/read",
    { uri: pluginJobUri(id) + "?cursor=fixture-before" },
    {
      modern: true,
      tools: [{ ...tools[0], name: "start_import" }],
      readJob: async (...args) => {
        calls.push(args);
        return page;
      },
    },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.json));
  assert.deepEqual(calls, [[id, "fixture-before"]]);
  assert.equal(result.json.result.contents[0].mimeType, "application/json");
  assert.deepEqual(JSON.parse(result.json.result.contents[0].text), page);
});
test("plugin import resources refuse unavailable tools and malformed scopes before job retrieval", async () => {
  const uri = pluginJobUri("00000000-0000-4000-8000-000000000001");
  let reads = 0;
  for (const [address, allowed] of [
    [uri, false],
    [uri + "?user=other", true],
  ] as const) {
    const result = await rpc(
      "resources/read",
      { uri: address },
      {
        modern: true,
        tools: allowed ? [{ ...tools[0], name: "start_import" }] : tools,
        readJob: async () => {
          reads++;
          return {};
        },
      },
    );
    assert.equal(result.json.error.code, -32602);
  }
  assert.equal(reads, 0);
});
test("plugin protocol refuses tools outside the current connection before invocation", async () => {
  let calls = 0;
  const result = await rpc(
    "tools/call",
    { name: "create_tasks", arguments: {} },
    {
      invoke: async () => {
        calls++;
        return { content: [] };
      },
    },
  );
  assert.equal(result.json.error.code, -32602);
  assert.equal(calls, 0);
});
test("plugin protocol dispatches permitted calls and preserves typed results", async () => {
  const result = await rpc(
    "tools/call",
    { name: "get_today", arguments: {} },
    {
      invoke: async (name, args) => {
        assert.equal(name, "get_today");
        assert.deepEqual(args, {});
        return {
          content: [{ type: "text", text: "Fixture" }],
          structuredContent: { count: 1 },
        };
      },
    },
  );
  assert.equal(result.json.result.structuredContent.count, 1);
});
test("plugin protocol lists and reads only scoped opt-in UI cards", async () => {
  assert.deepEqual((await rpc("resources/list")).json.result.resources, []);
  const resources = (await rpc("resources/list", undefined, { ui: true })).json
    .result.resources;
  assert.equal(resources.length, 1);
  const uri = resources[0].uri;
  const read = await rpc("resources/read", { uri }, { ui: true });
  assert.equal(
    read.json.result.contents[0].mimeType,
    "text/html;profile=mcp-app",
  );
  assert.deepEqual(read.json.result.contents[0]._meta.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
  });
  assert.equal((await rpc("resources/read", { uri })).json.error.code, -32602);
  assert.equal(
    (
      await rpc(
        "resources/read",
        { uri: "https://private.example.test/secret" },
        { ui: true },
      )
    ).json.error.code,
    -32602,
  );
});
test("plugin protocol communicates quota refusal and hides unexpected error details", async () => {
  const denied = await rpc(
    "tools/call",
    { name: "get_today" },
    {
      invoke: async () => {
        throw new PluginCallError(
          429,
          { error: "LIMITED", message: "Try later." },
          12,
        );
      },
    },
  );
  assert.equal(denied.json.error.data.httpStatus, 429);
  assert.equal(denied.json.error.data.retryAfter, 12);
  const failed = await rpc(
    "tools/call",
    { name: "get_today" },
    {
      invoke: async () => {
        throw new Error("private-fixture-token");
      },
    },
  );
  assert.equal(failed.json.error.code, -32603);
  assert.doesNotMatch(JSON.stringify(failed.json), /private-fixture-token/);
});

test("current plugin protocol discovery stays private with no reusable authority cache", async () => {
  const discovery = await rpc("server/discover", undefined, {
    modern: true,
    ui: true,
  });
  assert.equal(discovery.response.status, 200);
  assert.equal(discovery.json.result.cacheScope, "private");
  assert.equal(discovery.json.result.ttlMs, 0);
  assert.ok(
    discovery.json.result.capabilities.extensions["io.modelcontextprotocol/ui"],
  );
  const list = await rpc("tools/list", undefined, { modern: true });
  assert.equal(list.json.result.cacheScope, "private");
  assert.deepEqual(
    list.json.result.tools.map((tool: any) => tool.name),
    ["get_today"],
  );
  const called = await rpc(
    "tools/call",
    { name: "get_today", arguments: {} },
    { modern: true },
  );
  assert.equal(called.json.result.content[0].text, "Fixture");
});

test("plugin protocol rejects excessive argument structures before invocation", async () => {
  let calls = 0;
  let nested: unknown = "private-fixture";
  for (let depth = 0; depth < 17; depth++) nested = { nested };
  const result = await rpc(
    "tools/call",
    { name: "get_today", arguments: { nested } },
    {
      invoke: async () => {
        calls++;
        return { content: [] };
      },
    },
  );
  assert.equal(result.json.error.code, -32602);
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(result.json), /private-fixture/);
});
