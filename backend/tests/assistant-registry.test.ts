import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { projectDraftSchema } from "@orbyn/core";
// Checks the test database (see setup.ts), though nothing here reads it.
import "./setup.js";

/**
 * The built-in assistant's tools moved onto the capability registry
 * (capabilities/assistant.ts). Parity: what the assistant sends its
 * provider, how a call is found and how its arguments are checked are
 * exactly what they were, and none of its tools reaches the MCP registry.
 * No provider is called.
 */

const { TOOLS, TOOL_SPECS, ASSISTANT_REGISTRY, runTool } =
  await import("../src/modules/ai/agent/tools.js");
const { registry } = await import("../src/capabilities/index.js");
const { describe } = await import("../src/capabilities/registry.js");

/** The tools the assistant had before the move, in its order. */
const BEFORE = [
  "propose_project",
  "search_docs",
  "get_doc",
  "propose_note",
  "propose_doc_edit",
  "get_overview",
  "search_items",
  "get_item",
  "rank_tasks",
  "up_next",
  "get_work_patterns",
  "list_projects",
  "get_project",
  "find_free_time",
  "get_calendar",
  "get_study",
  "get_follow_through",
  "list_teams",
  "propose_create",
  "propose_update",
  "propose_delete",
  "ask_clarification",
  "plan_schedule",
  "propose_session_change",
];

test("every assistant tool is on the registry, in the same order", () => {
  assert.deepEqual(
    ASSISTANT_REGISTRY.all.map((c: { name: string }) => c.name),
    BEFORE,
  );
  assert.deepEqual(
    TOOLS.map((t: { spec: { name: string } }) => t.spec.name),
    BEFORE,
  );
});

test("the specs sent to the provider are the hand-written ones, unchanged", () => {
  assert.deepEqual(
    TOOL_SPECS,
    TOOLS.map((t: { spec: unknown }) => t.spec),
  );
  for (const spec of TOOL_SPECS) {
    assert.equal(typeof spec.description, "string");
    assert.ok(spec.description.length > 20, spec.name);
    assert.equal(spec.parameters.type, "object", spec.name);
  }
  // The one spec that was always derived from zod still is.
  const project = TOOL_SPECS.find(
    (s: { name: string }) => s.name === "propose_project",
  );
  assert.deepEqual(project.parameters, z.toJSONSchema(projectDraftSchema));
});

test("each capability checks arguments with the tool's own schema", () => {
  for (const t of TOOLS) {
    const cap = ASSISTANT_REGISTRY.get(t.spec.name)!;
    assert.equal(cap.input, t.args, t.spec.name);
    // It describes as a capability like any other.
    const d = describe(cap);
    assert.equal(d.inputSchema.type, "object", t.spec.name);
    // Reads are tier R; everything else only proposes (W3, for review).
    if (/^propose_|^ask_clarification$|^plan_schedule$/.test(t.spec.name)) {
      assert.equal(cap.mode, "propose", t.spec.name);
      assert.equal(cap.tier, "W3", t.spec.name);
    } else {
      assert.equal(cap.mode, "read", t.spec.name);
      assert.equal(cap.tier, "R", t.spec.name);
      assert.equal(cap.annotations.readOnlyHint, true, t.spec.name);
    }
  }
});

test("none of them reaches outside agents: the MCP registry never lists them", () => {
  for (const c of ASSISTANT_REGISTRY.all) {
    const onMcp = registry.get(c.name);
    // Same-named MCP tools (get_project, get_calendar, plan_schedule) are
    // separate capabilities with their own schemas.
    if (onMcp) assert.notEqual(onMcp, c, c.name);
  }
});

test("runTool answers as before: unknown names, bad JSON, bad arguments", async () => {
  const ctx = {
    user: { id: "00000000-0000-4000-8000-000000000000", role: "member" },
    timezone: "UTC",
    intentText: "",
    actions: [],
    clarification: null,
  } as never;
  const unknown = await runTool(
    { id: "1", name: "delete_everything", arguments: "{}" } as never,
    ctx,
  );
  assert.equal(unknown.isError, true);
  assert.match(
    unknown.content,
    /Unknown tool \\"delete_everything\\"\. Available: propose_project, /,
  );
  const json = await runTool(
    { id: "2", name: "get_item", arguments: "{nope" } as never,
    ctx,
  );
  assert.match(json.content, /not valid JSON/);
  const args = await runTool(
    {
      id: "3",
      name: "get_item",
      arguments: JSON.stringify({ id: 5 }),
    } as never,
    ctx,
  );
  assert.equal(args.isError, true);
  assert.match(args.content, /Invalid arguments for get_item/);
  // The provider's "functions." prefix still resolves.
  const prefixed = await runTool(
    { id: "4", name: "functions.nothing_here", arguments: "{}" } as never,
    ctx,
  );
  assert.match(prefixed.content, /Unknown tool/);
});
