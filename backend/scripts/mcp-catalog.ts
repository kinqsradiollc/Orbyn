// Writes docs/mcp-catalog.json, docs/mcp.md and the "orbyn" Agent Skill
// (docs/agent-skill/orbyn/SKILL.md) from the capability registry.
// Run after changing a tool: npm run mcp:catalog -w backend
// (mcp-catalog.test.ts fails until the committed files match.)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFiles } from "./mcp-catalog-files.js";

for (const file of await catalogFiles()) {
  await mkdir(dirname(fileURLToPath(file.url)), { recursive: true });
  await writeFile(fileURLToPath(file.url), file.content);
  process.stdout.write(`wrote ${fileURLToPath(file.url)}\n`);
}
