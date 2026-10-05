import { test } from "node:test";
import assert from "node:assert/strict";
import { providerDetailLines, chatTraceEntry } from "@orbyn/core";
const event = (
  tool: string,
  label: string,
  kind: "thinking" | "result" = "result",
) =>
  chatTraceEntry.parse({
    turn_id: "00000000-0000-4000-8000-000000000001",
    step: 1,
    kind,
    tool,
    label,
    at: "2026-10-04T00:00:00.000Z",
  });
test("provider receipts distinguish completed use from requested fallback and retain old trace compatibility", () => {
  const trace = [
    event("pc_c", "ChatGPT · model-a · completed"),
    event("pf_s", "Orbyn fallback · model-b · started", "thinking"),
  ];
  assert.deepEqual(providerDetailLines(trace), [
    "ChatGPT · model-a · completed",
    "Orbyn fallback · model-b · started",
  ]);
  trace.push(event("pf_c", "Orbyn fallback · model-b · completed"));
  assert.deepEqual(providerDetailLines(trace), [
    "ChatGPT · model-a · completed",
    "Orbyn fallback · model-b · completed",
  ]);
  assert.deepEqual(
    providerDetailLines([
      event("search", "ChatGPT · forged label · completed"),
    ]),
    [],
  );
  assert.deepEqual(
    providerDetailLines([...trace, trace[0]]),
    providerDetailLines(trace),
  );
});
