import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeSources } from "../src/modules/ai/agent/sources.js";

test("assistant sources keep read references and drop invented ones", () => {
  const checked = finalizeSources(
    "Write copy [2] and review the decision [99].",
    [
      {
        kind: "task",
        id: "task-1",
        title: "Write copy",
        quote: "Due Friday",
        number: 2,
      },
      {
        doc_id: "page-1",
        title: "Launch brief",
        block_id: "line-4",
        quote: "Copy",
        number: 3,
      },
    ],
  );
  assert.equal(checked.summary, "Write copy [2] and review the decision .");
  assert.deepEqual(
    checked.sources.map((source) => [source.number, source.used]),
    [
      [2, true],
      [3, false],
    ],
  );
});
