import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMaintainedPagePatch,
  captureMaintainedPage,
  checkMaintainedPage,
  maintainedPageSnapshot,
  MAX_MAINTAINED_BLOCKS,
  maintainedPageTokenBudget,
  type DocBlock,
} from "@orbyn/core";
const content: DocBlock[] = [
  { id: "human", type: "paragraph", text: "Human notes stay here." },
  { id: "summary", type: "paragraph", text: "Previous summary." },
  { id: "review", type: "heading", level: 2, text: "Review" },
];
const capture = () => {
  const snapshot = captureMaintainedPage(content, 4, ["review", "summary"]);
  assert.ok(snapshot.ok);
  return snapshot.value;
};
test("page work budgets enforce integer bounds", () => {
  for (const value of [1000, 5000, 20000])
    assert.equal(maintainedPageTokenBudget.parse(value), value);
  for (const value of [0, -1, 999, 20001, 1000.5, Infinity, NaN, "1000"])
    assert.equal(maintainedPageTokenBudget.safeParse(value).success, false);
});
test("maintained page snapshots preserve page order and contain no private text", () => {
  assert.deepEqual(capture(), {
    doc_version: 4,
    blocks: [
      { block_id: "summary", position: 1 },
      { block_id: "review", position: 2 },
    ],
  });
  assert.ok(!JSON.stringify(capture()).includes("Previous summary"));
  assert.ok(
    !maintainedPageSnapshot.safeParse({ ...capture(), content }).success,
  );
});
test("bound updates preserve human and unchanged block objects without mutating input", () => {
  const before = JSON.stringify(content);
  const next = applyMaintainedPagePatch(content, 4, capture(), [
    { id: "summary", type: "paragraph", text: "Updated summary." },
  ]);
  assert.ok(next.ok);
  assert.equal(next.value[0], content[0]);
  assert.equal(next.value[2], content[2]);
  assert.equal(next.value[1].id, "summary");
  assert.equal(JSON.stringify(content), before);
});
test("any concurrent page revision conflicts before replacements are applied", () => {
  assert.deepEqual(applyMaintainedPagePatch(content, 5, capture(), []), {
    ok: false,
    reason: "version",
  });
});
test("deleted or moved targets invalidate their binding without retargeting", () => {
  assert.deepEqual(checkMaintainedPage(content.slice(0, 2), 4, capture()), {
    ok: false,
    reason: "missing",
  });
  assert.deepEqual(
    checkMaintainedPage([content[1], content[0], content[2]], 4, capture()),
    { ok: false, reason: "moved" },
  );
});
test("duplicate block identities and replacement identities are rejected", () => {
  assert.deepEqual(
    captureMaintainedPage([...content, content[0]], 4, ["summary"]),
    { ok: false, reason: "ambiguous" },
  );
  assert.deepEqual(
    captureMaintainedPage([...content, content[1]], 4, ["summary"]),
    { ok: false, reason: "ambiguous" },
  );
  assert.deepEqual(
    applyMaintainedPagePatch(content, 4, capture(), [content[1], content[1]]),
    { ok: false, reason: "ambiguous" },
  );
  assert.throws(() =>
    captureMaintainedPage(content, 4, ["summary", "summary"]),
  );
});
test("replacements cannot write human blocks or introduce new unbound identities", () => {
  for (const block of [
    content[0],
    { type: "paragraph", text: "Unidentified" } as DocBlock,
    { id: "new", type: "paragraph", text: "Unbound" } as DocBlock,
  ])
    assert.deepEqual(applyMaintainedPagePatch(content, 4, capture(), [block]), {
      ok: false,
      reason: "outside_binding",
    });
});
test("snapshot size and metadata are bounded and malformed blocks fail validation", () => {
  assert.throws(() => captureMaintainedPage(content, 0, ["summary"]));
  assert.throws(() =>
    captureMaintainedPage(
      content,
      4,
      Array.from({ length: MAX_MAINTAINED_BLOCKS + 1 }, (_, i) => `block-${i}`),
    ),
  );
  assert.throws(() =>
    applyMaintainedPagePatch(content, 4, capture(), [
      { id: "summary", type: "unknown" } as never,
    ]),
  );
  assert.ok(
    !maintainedPageSnapshot.safeParse({
      ...capture(),
      blocks: [
        { block_id: "summary", position: 1 },
        { block_id: "review", position: 1 },
      ],
    }).success,
  );
});
