import { test } from "node:test";
import assert from "node:assert/strict";

const { registry } = await import("../src/capabilities/index.js");
const { describe } = await import("../src/capabilities/registry.js");
const { listedTool } = await import("../src/modules/mcp-server/server.js");
const { leadTools } = await import("../src/modules/ai/agent/lead.js");
const { specialistToolSpecs } =
  await import("../src/modules/ai/agent/specialist.js");
const { ASSISTANT_TOOL_DESCRIPTIONS } =
  await import("../src/capabilities/assistant.js");
const {
  assertSpecialistTools,
  SHARED_ASSISTANT_READS,
  SPECIALISTS,
  specialistToolNames,
} = await import("../src/modules/ai/agent/specialists.js");

test("built-in lead and specialists use the same listable MCP capabilities", () => {
  assertSpecialistTools();
  const listed = registry.all.filter((capability) => !capability.legacyOnly);
  assert.equal(listed.length, 65);
  assert.equal(
    listed.filter((capability) => capability.toolset === "core").length,
    33,
  );
  assert.equal(new Set(listed.map((capability) => capability.name)).size, 65);

  const assistantSpecs = [
    ...leadTools,
    ...(Object.keys(SPECIALISTS) as (keyof typeof SPECIALISTS)[]).flatMap(
      (name) => specialistToolSpecs(name, true),
    ),
  ].filter(
    (spec) =>
      !["delegate", "ask_person", "finish", "report"].includes(spec.name) &&
      registry.get(spec.name),
  );
  for (const spec of assistantSpecs) {
    const capability = registry.get(spec.name)!;
    const info = describe(capability);
    const mcp = listedTool(capability);
    assert.equal(
      spec.description,
      ASSISTANT_TOOL_DESCRIPTIONS[spec.name] ?? info.description,
      `${spec.name} description`,
    );
    assert.deepEqual(spec.parameters, info.inputSchema, `${spec.name} input`);
    assert.deepEqual(
      mcp.inputSchema,
      info.inputSchema,
      `${spec.name} MCP input`,
    );
    assert.deepEqual(
      mcp.outputSchema,
      info.outputSchema,
      `${spec.name} MCP output`,
    );
  }

  for (const [name, description] of Object.entries(
    ASSISTANT_TOOL_DESCRIPTIONS,
  )) {
    assert.equal(typeof description, "string", `${name} stays text-only`);
    assert.ok(description.length > 0, `${name} has a tuned description`);
    assert.ok(registry.get(name), `${name} still comes from the MCP registry`);
  }

  for (const name of SHARED_ASSISTANT_READS) {
    const capability = registry.get(name);
    assert.ok(capability, `${name} is registered for MCP`);
    assert.equal(capability.mode, "read", `${name} stays read-only`);
    assert.deepEqual(
      listedTool(capability).inputSchema,
      describe(capability).inputSchema,
    );
    assert.deepEqual(
      listedTool(capability).outputSchema,
      describe(capability).outputSchema,
    );
  }

  const assistantNames = new Set<string>([
    "apply_plan",
    ...SHARED_ASSISTANT_READS,
  ]);
  for (const name of Object.keys(SPECIALISTS) as (keyof typeof SPECIALISTS)[]) {
    for (const tool of specialistToolNames(name)) assistantNames.add(tool);
  }
  for (const name of assistantNames) {
    assert.ok(
      listed.some((capability) => capability.name === name),
      `internal assistant tool ${name} is also listed by MCP`,
    );
  }

  const context = registry.get("get_context");
  assert.ok(context);
  const fields = Object.keys(describe(context).outputSchema.properties ?? {});
  for (const field of [
    "agent",
    "user",
    "connection",
    "teams",
    "limits",
    "links",
    "conventions",
    "profile",
    "learning",
    "instructions",
    "rules",
    "since",
    "memory",
  ])
    assert.ok(
      fields.includes(field),
      `shared get_context output includes ${field}`,
    );
});
