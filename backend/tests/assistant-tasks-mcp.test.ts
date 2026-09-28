import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "./setup.js";
import { helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * W3 over MCP: an outside agent may hand a task to the person's own agent
 * only by asking first, since the run spends Orbyn's hosted assistant.
 */
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

type ToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};
let me: Person;
let other: Person;
const idOf = (ref: string) => ref.replace(/^\w+:/, "");

const call = async (key: string, name: string, args: unknown) => {
  const response = await h.legacy(key, "tools/call", {
    name,
    arguments: args,
  });
  const result = response.body?.result as ToolResult | undefined;
  assert.ok(result, `${name}: ${JSON.stringify(response.body)}`);
  return result;
};
const agentRow = async (id: string) =>
  (
    await pool.query<{ agent_grant_id: string | null; agent_state: string }>(
      "SELECT agent_grant_id, agent_state FROM items WHERE id = $1",
      [id],
    )
  ).rows[0];

before(async () => {
  await migrate();
  me = await h.register("hand-over", "Hand over");
  other = await h.register("hand-other", "Someone else");
});

after(async () => {
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [me.id, other.id],
  ]);
  assert.deepEqual(network.calls, [], "no real AI provider is ever called");
  network.restore();
  await app.close();
  await pool.end();
});

test("an outside agent's hand-over to Orbyn always waits in Review", async () => {
  const anonymous = await h.post({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "update_tasks", arguments: { changes: [] } },
  });
  assert.equal(anonymous.status, 401);

  const made = await h.call(me.token, "POST", "/items", {
    title: "Draft the report",
    kind: "task",
  });
  assert.equal(made.statusCode, 201, made.body);
  const item = made.json() as { id: string; version: number };

  // Even a full-power connection only asks.
  const full = await h.agentKey(me, { access: "write", trust: "full" });
  const asked = await call(full.key, "update_tasks", {
    changes: [
      { id: `task:${item.id}`, version: item.version, agent: "assistant" },
    ],
  });
  assert.ok(!asked.isError, asked.content?.[0]?.text);
  assert.equal(asked.structuredContent.status, "pending_review");
  assert.equal((await agentRow(item.id)).agent_grant_id, null);
  const proposal = idOf(asked.structuredContent.pending.proposal_id);
  const shown = await h.call(me.token, "GET", `/proposals/${proposal}`);
  assert.equal(shown.statusCode, 200, shown.body);
  assert.equal(shown.json().changes[0].type, "task.hand");
  assert.equal(
    shown.json().changes[0].headline,
    "Hand “Draft the report” to Orbyn",
  );

  // Only the person approves; then the task waits for Orbyn.
  const stranger = await h.call(
    other.token,
    "POST",
    `/proposals/${proposal}/apply`,
    {},
  );
  assert.notEqual(stranger.statusCode, 200);
  const approved = await h.call(
    me.token,
    "POST",
    `/proposals/${proposal}/apply`,
    {},
  );
  assert.equal(approved.statusCode, 200, approved.body);
  const grant = (
    await assistantPrincipal({ id: me.id, name: me.name, role: "member" })
  ).grant_id;
  assert.deepEqual(await agentRow(item.id), {
    agent_grant_id: grant,
    agent_state: "queued",
  });

  // A bad value is refused, and a read-only connection can't ask at all.
  const bad = await call(full.key, "update_tasks", {
    changes: [{ id: `task:${item.id}`, version: item.version, agent: "me" }],
  });
  assert.ok(bad.isError);
  const reader = await h.agentKey(me, { access: "read" });
  const readOnly = await call(reader.key, "update_tasks", {
    changes: [
      { id: `task:${item.id}`, version: item.version, agent: "assistant" },
    ],
  });
  assert.ok(readOnly.isError);
});
