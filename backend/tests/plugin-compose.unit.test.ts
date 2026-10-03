import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("plugin deployment is opt-in, separate and loopback-only", () => {
  const compose = readFileSync(
    new URL("../../compose.yaml", import.meta.url),
    "utf8",
  );
  const block = compose.match(
    /^  plugin:\n([\s\S]*?)(?=^  [a-z][a-z_-]*:)/m,
  )?.[1];
  assert.ok(block);
  assert.match(block, /profiles: \[plugin\]/);
  assert.match(block, /backend\/dist\/services\/plugin\.js/);
  assert.match(block, /127\.0\.0\.1:\$\{PLUGIN_PORT:-8040\}:8000/);
  assert.match(block, /PLUGIN_PUBLIC_URL: \$\{PLUGIN_PUBLIC_URL:-\}/);
  assert.match(
    block,
    /migrate: \{ condition: service_completed_successfully \}/,
  );
  assert.match(block, /pgbouncer: \{ condition: service_healthy \}/);
  assert.doesNotMatch(block, /network_mode: host|services\/(?:api|ai|mcp)\.js/);
});
