import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
let session = "";
let apiKey = "";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
/** One JSON-RPC call to /mcp with the API key. */
const rpc = async (method: string, params?: unknown, id: number | null = 1) => {
  const r = await app.inject({
    method: "POST",
    url: "/mcp",
    headers: bearer(apiKey),
    payload: { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params },
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const callTool = (name: string, args: object) =>
  rpc("tools/call", { name, arguments: args });
const text = (b: { result?: { content?: { text: string }[] } }) =>
  b.result?.content?.[0]?.text ?? "";

before(async () => {
  await migrate();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `mcp-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "M",
    },
  });
  session = reg.json().token;
  const key = await app.inject({
    method: "POST",
    url: "/me/api-keys",
    headers: bearer(session),
    payload: { name: "MCP" },
  });
  apiKey = key.json().key;
});
after(async () => {
  await app.close();
  await pool.end();
});

test("the endpoint needs authentication", async () => {
  const r = await app.inject({
    method: "POST",
    url: "/mcp",
    payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  assert.equal(r.statusCode, 401);
});

test("initialize and tools/list describe the server and its tools", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(init.body.result.serverInfo.name, "Orbyn");
  assert.ok(init.body.result.capabilities.tools);

  const list = await rpc("tools/list");
  const names = list.body.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names.sort(), ["add_task", "get_agenda", "search_items"]);
});

test("a notification (no id) gets no response body", async () => {
  const r = await rpc("notifications/initialized", {}, null);
  assert.equal(r.status, 202);
});

test("add_task creates a task that search and agenda then find", async () => {
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const added = await callTool("add_task", {
    title: "Renew passport",
    due_at: soon,
    priority: "high",
  });
  assert.match(text(added.body), /Added "Renew passport"/);

  // It really exists via the normal API.
  const items = await app.inject({
    method: "GET",
    url: "/items",
    headers: bearer(session),
  });
  assert.ok(
    items.json().some((i: { title: string }) => i.title === "Renew passport"),
  );

  const found = await callTool("search_items", { query: "passport" });
  assert.match(text(found.body), /Renew passport/);

  const agenda = await callTool("get_agenda", { days: 7 });
  assert.match(text(agenda.body), /Renew passport/);
});

test("an unknown method and an unknown tool are reported cleanly", async () => {
  const bad = await rpc("does/not/exist");
  assert.equal(bad.body.error.code, -32601);

  const badTool = await callTool("delete_everything", {});
  assert.equal(badTool.body.error.code, -32602);

  // A tool that throws reports the error in-band, not as a transport failure.
  const empty = await callTool("search_items", { query: "" });
  assert.equal(empty.status, 200);
  assert.match(text(empty.body), /words to search/);
});
