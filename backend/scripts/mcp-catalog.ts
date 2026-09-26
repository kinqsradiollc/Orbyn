// Writes docs/mcp-catalog.json and docs/mcp.md from the capability registry.
// Run after changing a tool: npm run mcp:catalog -w backend
// (mcp-catalog.test.ts fails until the committed files match.)
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalogFiles } from "./mcp-catalog-files.js";

for (const file of await catalogFiles()) {
  await writeFile(fileURLToPath(file.url), file.content);
  process.stdout.write(`wrote ${fileURLToPath(file.url)}\n`);
}
