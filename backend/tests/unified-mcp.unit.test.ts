import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { DEFAULT_AGENT_SETTINGS } from "@orbyn/core";
import type { Principal } from "../src/capabilities/policy.js";
import type { LiveSettings } from "../src/lib/settings.js";
import { env } from "../src/config/env.js";
import { serve } from "../src/modules/mcp-server/server.js";
import { workspaceAiTools } from "../src/modules/mcp-server/workspace-ai.js";
import { withResultPreview } from "../src/modules/mcp-server/result-preview.js";
import {
  pluginResources,
  readPluginResource,
} from "../src/modules/mcp-server/host-surfaces.js";
import { pluginJobCursor } from "../src/modules/plugin/job-cursor.js";

const principal = (): Principal => ({
  user: { id: "owner", name: "Owner", role: "member" },
  via: "oauth",
  grant_id: "grant",
  client: { id: "client", name: "Client" },
  access: "write",
  personal: true,
  team_ids: [],
  toolsets: ["core", "workspace"],
  flags: {
    readonly: false,
    notify_teammates: false,
    hide_outside_content: false,
  },
  trust: { level: "full", spaces: {}, acts_alone: [] },
  teams: [],
});
async function rpc(
  method: string,
  params: object,
  apps = true,
  p = principal(),
) {
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const response = await serve(
    {
      caller: { principal: p } as never,
      settings: {
        agents: { ...DEFAULT_AGENT_SETTINGS, mcp_apps_enabled: apps },
      } as LiveSettings,
      primary: true,
      write: async () => {
        throw new Error("No writes allowed in this fixture");
      },
      onCall: () => {},
      log: () => {},
    },
    new Request("http://fixture.test/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    }),
    body,
    true,
  );
  return response.json();
}

test("MCP lists sidebar/file/mentions and domain result previews with UI enabled", async () => {
  const result = await rpc("tools/list", {});
  const tools = result.result.tools;
  for (const name of [
    "open_orbyn",
    "open_markdown_file",
    "search_orbyn_mentions",
    "fetch",
    "edit_doc",
  ])
    assert.ok(
      tools.some((tool: any) => tool.name === name),
      name,
    );
  assert.equal(
    tools.find((tool: any) => tool.name === "fetch")._meta.ui.resourceUri,
    "ui://orbyn/result.html",
  );
  const file = tools.find((tool: any) => tool.name === "open_markdown_file");
  assert.deepEqual(file._meta.ui, {
    resourceUri: "ui://orbyn/markdown-file.html",
    visibility: ["model", "app"],
  });
  assert.deepEqual(file._meta["openai/ui"], {
    entrypoints: [{ type: "file", extensions: [".md", ".markdown"] }],
  });
  assert.match(file.description, /Never invent a handle/);
  const resource = await rpc("resources/read", {
    uri: file._meta.ui.resourceUri,
  });
  assert.equal(
    resource.result.contents[0].mimeType,
    "text/html;profile=mcp-app",
  );
  assert.match(resource.result.contents[0].text, /Markdown/);
  const opened = await rpc("tools/call", { name: "open_orbyn", arguments: {} });
  assert.deepEqual(opened.result.structuredContent, { kind: "plugin_home" });
});

test("UI opt-out preserves ordinary tools and removes host surfaces", async () => {
  const result = await rpc("tools/list", {}, false);
  assert.ok(result.result.tools.some((tool: any) => tool.name === "fetch"));
  assert.ok(
    !result.result.tools.some((tool: any) => tool.name === "open_orbyn"),
  );
  assert.ok(
    !result.result.tools.some(
      (tool: any) => tool.name === "open_markdown_file",
    ),
  );
  assert.equal(
    readPluginResource(
      "ui://orbyn/markdown-file.html",
      ["open_markdown_file"],
      false,
    ),
    null,
  );
  assert.equal(
    result.result.tools.find((tool: any) => tool.name === "fetch")._meta.ui,
    undefined,
  );
});

test("host file handles are bounded; opening never reads the backend or writes", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("File launch must not dereference the supplied handle");
  });
  const handle = "https://handle.example.test/private.md";
  const accepted = await rpc("tools/call", {
    name: "open_markdown_file",
    arguments: {
      file: { name: "notes.md", resourceUri: handle },
    },
  });
  assert.deepEqual(accepted.result.structuredContent, {
    kind: "markdown_file",
  });
  assert.equal(network.mock.callCount(), 0);
  assert.equal(JSON.stringify(accepted).includes(handle), false);
  const refused = await rpc("tools/call", {
    name: "open_markdown_file",
    arguments: {
      file: { name: "../secret.md", resourceUri: "host-resource://opaque" },
    },
  });
  assert.equal(refused.result.isError, true);
});

test("document preview preserves authorized text/anchors, disables edit for read grants and escapes HTML", () => {
  const value = {
    content: [],
    structuredContent: {
      id: "doc:00000000-0000-4000-8000-000000000000",
      title: "Page",
      text: "# Heading ^bheading\n\n<script>alert(1)</script> ^bline",
      metadata: { type: "doc", version: 3, truncated: false },
    },
  };
  const result = withResultPreview(value, principal());
  assert.deepEqual(result.structuredContent, value.structuredContent);
  const preview = result._meta?.["orbyn/document-preview"] as any;
  assert.equal(preview.version, 3);
  assert.equal(preview.editable, true);
  assert.ok(preview.lines.some((line: any) => line.anchor === "bline"));
  assert.doesNotMatch(preview.html, /<script>/);
  const readonly = withResultPreview(value, { ...principal(), access: "read" });
  assert.equal(
    (readonly._meta?.["orbyn/document-preview"] as any).editable,
    false,
  );
});

test("generic resource is permission-filtered and its app script parses", () => {
  assert.deepEqual(pluginResources([], true), []);
  assert.equal(readPluginResource("ui://orbyn/result.html", [], true), null);
  const resource = readPluginResource(
    "ui://orbyn/result.html",
    ["fetch"],
    true,
  )!;
  const script = resource.contents[0].text.match(
    /<script>([\s\S]*)<\/script>/,
  )?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.match(script, /setAttribute\("sandbox","allow-scripts"\)/);
  assert.match(script, /version:submitted.version/);
  assert.match(script, /client_ref:submitted.client_ref/);
});

test("canonical job cursor binds audience, connection and authority independently of legacy", () => {
  const key = Buffer.alloc(32, 7),
    binding = {
      resource: "https://mcp.test/mcp",
      jobId: "00000000-0000-4000-8000-000000000000",
      sourceRevision: "1",
    };
  const codec = pluginJobCursor(principal(), binding, key);
  const cursor = codec.seal(12, Date.now() + 60000);
  assert.equal(codec.open(cursor), 12);
  assert.throws(() =>
    pluginJobCursor(
      { ...principal(), via: "plugin" },
      { ...binding, resource: "https://mcp.test/plugin" },
      key,
    ).open(cursor),
  );
  assert.throws(() =>
    pluginJobCursor(
      { ...principal(), grant_id: "different" },
      binding,
      key,
    ).open(cursor),
  );
});

test("workspace inference tools exclude keys and require the explicit canonical switch", () => {
  const previous = env.MCP_WORKSPACE_AI_ENABLED;
  try {
    env.MCP_WORKSPACE_AI_ENABLED = "false";
    assert.deepEqual(
      workspaceAiTools(principal()).map((tool) => tool.name),
      ["get_workspace_ai_status"],
    );
    env.MCP_WORKSPACE_AI_ENABLED = "true";
    assert.ok(
      workspaceAiTools(principal()).some(
        (tool) => tool.name === "request_workspace_ai",
      ),
    );
    for (const via of [
      "agent_key",
      "legacy_key",
      "session",
      "assistant",
      "plugin",
    ] as const)
      assert.deepEqual(workspaceAiTools({ ...principal(), via }), []);
  } finally {
    env.MCP_WORKSPACE_AI_ENABLED = previous;
  }
});

test("partial document metadata distinguishes page continuation, complete block bounds and edit list limits", () => {
  const preview = (text: string, metadata: object = {}) =>
    withResultPreview(
      {
        content: [],
        structuredContent: {
          id: "doc:00000000-0000-4000-8000-000000000000",
          text,
          metadata: { type: "doc", version: 3, ...metadata },
        },
      },
      principal(),
    )._meta?.["orbyn/document-preview"] as any;
  const paged = preview("Complete line ^bline", {
    truncated: true,
    next_block: "bnext",
  });
  assert.equal(paged.paginated, true);
  assert.equal(paged.locallyClipped, false);
  assert.equal(paged.nextBlock, "bnext");
  const oversized = preview("x".repeat(61000) + " ^bgiant");
  assert.equal(oversized.truncated, true);
  assert.equal(oversized.locallyClipped, true);
  assert.equal(oversized.editable, false);
  assert.deepEqual(oversized.lines, []);
  const many = preview(
    Array.from({ length: 101 }, (_, i) => "Line " + i + " ^bline" + i).join(
      "\n\n",
    ),
  );
  assert.equal(many.editListLimited, true);
  assert.equal(many.lines.length, 100);
});
