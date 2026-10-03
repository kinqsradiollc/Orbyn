import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { prepareMermaidSource } from "@orbyn/core";

// Syntax/sanitizer acceptance, not visual rendering. External resources stay disabled.
const fixtures = JSON.parse(
  await readFile(
    new URL("../../docs/fixtures/mermaid.json", import.meta.url),
    "utf8",
  ),
);
if (fixtures.length !== 10)
  throw new Error("Expected ten diagram acceptance fixtures.");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
});
const { default: mermaid } = await import("mermaid");
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
});
try {
  for (const fixture of fixtures) {
    await mermaid.parse(prepareMermaidSource(fixture.source));
    process.stdout.write(`${fixture.kind}: parsed under strict policy\n`);
  }
} finally {
  dom.window.close();
}
