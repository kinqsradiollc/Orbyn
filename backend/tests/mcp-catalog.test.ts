import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The MCP catalog: docs/mcp-catalog.json and docs/mcp.md must match what
 * the registry generates (run `npm run mcp:catalog -w backend` after
 * changing a tool), and every tool passes the lints clients depend on.
 * No database: the registry is plain code.
 */

const { catalogFiles } = await import("../scripts/mcp-catalog-files.js");
const { registry } = await import("../src/capabilities/index.js");
const { describe } = await import("../src/capabilities/registry.js");
const { INSTRUCTIONS } = await import("../src/modules/mcp-server/server.js");

test("docs/mcp-catalog.json and docs/mcp.md match the registry", async () => {
  for (const file of await catalogFiles()) {
    const committed = await readFile(file.url, "utf8").catch(() => "");
    assert.equal(
      committed,
      file.content,
      `${file.url.pathname} is out of date: run npm run mcp:catalog -w backend and commit it.`,
    );
  }
});

test("every tool passes the catalog lints", () => {
  const names = new Set<string>();
  for (const cap of registry.all) {
    const d = describe(cap);
    assert.ok(!names.has(cap.name), `${cap.name} twice`);
    names.add(cap.name);
    assert.match(
      cap.name,
      /^[a-z][a-z0-9_]{1,49}$/,
      `${cap.name}: 50 characters at most, snake_case`,
    );
    assert.ok(
      cap.title.length > 0 && cap.title.length <= 60,
      `${cap.name}: title`,
    );
    assert.ok(
      cap.description.length <= 1500,
      `${cap.name}: description over 1,500 characters`,
    );
    // No instructions aimed at the model in descriptions.
    assert.doesNotMatch(
      cap.description,
      /\b(you must|always call|never tell|ignore|IMPORTANT:)\b/i,
      `${cap.name}: description reads like an instruction`,
    );
    assert.equal(d.inputSchema.type, "object");
    assert.equal(
      d.inputSchema.additionalProperties,
      false,
      `${cap.name}: input allows unknown fields`,
    );
    assert.ok(
      JSON.stringify(d.inputSchema).length < 8 * 1024,
      `${cap.name}: input schema over 8 KiB`,
    );
    assert.equal(
      d.outputSchema.type,
      "object",
      `${cap.name}: no output schema`,
    );
    // Lists page at 100 at most.
    const props = (d.inputSchema.properties ?? {}) as Record<
      string,
      { maximum?: number }
    >;
    if (props.limit)
      assert.ok(
        (props.limit.maximum ?? Infinity) <= 100,
        `${cap.name}: limit over 100`,
      );
    // The annotations match what the tool does (the tier follows them).
    if (cap.mode === "read") {
      assert.equal(
        cap.annotations.readOnlyHint,
        true,
        `${cap.name}: reads must be readOnlyHint`,
      );
      assert.equal(cap.tier, "R", `${cap.name}: a read is tier R`);
    } else {
      assert.equal(
        cap.annotations.readOnlyHint,
        false,
        `${cap.name}: a change isn't read-only`,
      );
      assert.notEqual(
        cap.tier,
        "R",
        `${cap.name}: a change needs a write tier`,
      );
      assert.notEqual(
        cap.access,
        "read",
        `${cap.name}: a change needs more than read access`,
      );
      if (
        cap.effects?.some(
          (e) =>
            e === "email_outside" || e === "publish" || e === "fetch_outside",
        )
      )
        assert.equal(
          cap.tier,
          "W3",
          `${cap.name}: outward effects always go to review`,
        );
    }
    assert.equal(
      cap.annotations.openWorldHint,
      false,
      `${cap.name}: no tool reaches outside Orbyn`,
    );
  }
});

test("budgets: the tool list stays small, and the instructions short", () => {
  const core = registry.all.filter(
    (c) => c.toolset === "core" && !c.legacyOnly,
  );
  const size = JSON.stringify(core.map((c) => describe(c))).length;
  // About 16k tokens for the 20 core tools, reads and changes together
  // (roughly four characters a token): A3's twelve write tools share one
  // compact answer shape and pattern-free id and time fields to fit.
  assert.ok(size < 64_000, `tools/list for core is ${size} characters`);
  assert.ok(
    INSTRUCTIONS.length <= 2048,
    `instructions are ${INSTRUCTIONS.length} characters`,
  );
  const first = INSTRUCTIONS.slice(0, 512);
  assert.match(first, /Orbyn is a planner/);
  assert.match(first, /get_context/);
});

test("ChatGPT's search and fetch keep their contract", () => {
  const search = describe(registry.get("search")!);
  assert.deepEqual(search.inputSchema.required, ["query"]);
  const fetch = describe(registry.get("fetch")!);
  assert.deepEqual(fetch.inputSchema.required, ["id"]);
  assert.ok(registry.get("search")!.jsonText);
  assert.ok(registry.get("fetch")!.jsonText);
});
