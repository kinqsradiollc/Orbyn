import { readFileSync } from "node:fs";

/** Shared syntax acceptance fixtures used by bounds and actual-engine checks. */
export const mermaidFixtures: { kind: string; source: string }[] = JSON.parse(
  readFileSync(
    new URL("../../../docs/fixtures/mermaid.json", import.meta.url),
    "utf8",
  ),
);
