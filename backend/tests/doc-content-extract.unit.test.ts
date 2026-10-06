import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractDocContent,
  parseDocContainers,
  docContainerBlocks,
  docContainerTaskBlocks,
  type VersionedDocContent,
  type DocBlock,
} from "@orbyn/core";
const link: DocBlock = {
  type: "paragraph",
  id: "link",
  text: "[Moved](orbyn://doc/00000000-0000-4000-8000-000000000001)",
};
const fixture = (): VersionedDocContent & { format: 2 } => ({
  format: 2,
  nodes: parseDocContainers(
    "> [!NOTE]\n> - [x] Task ^task\n>\n>   Continuation ^continuation\n>\n>   ```mermaid\n>   graph TD; A-->B\n>   ```\n>\n> - [ ] Other ^other\n\nOutside ^outside",
    { anchors: true },
  ),
});
const leaves = (content: VersionedDocContent) =>
  content.format === 2 ? docContainerBlocks(content.nodes) : content.blocks;
const tasks = (content: VersionedDocContent) =>
  content.format === 2
    ? docContainerTaskBlocks(content.nodes).filter((b) => b.type === "todo")
    : content.blocks.filter((b) => b.type === "todo");

test("extracting a task retains its quote/list owners and moves its checkbox once", () => {
  const original = fixture(),
    before = structuredClone(original);
  const result = extractDocContent(original, ["task"], link);
  assert.deepEqual(original, before);
  assert.equal(result.extracted.format, 2);
  assert.equal((result.extracted as any).nodes[0].kind, "quote");
  assert.deepEqual((result.extracted as any).nodes[0].callout, {
    tone: "note",
    folded: false,
  });
  assert.deepEqual(
    tasks(result.extracted).map((b) => b.id),
    ["task"],
  );
  assert.deepEqual(
    tasks(result.source).map((b) => b.id),
    ["other"],
  );
  assert.equal(leaves(result.source)[0].id, "link");
  assert.ok(
    leaves(result.source).some(
      (b) => b.type === "code" && b.lang === "mermaid",
    ),
  );
});
test("moving a continuation does not duplicate its owning task", () => {
  const result = extractDocContent(fixture(), ["continuation"], link);
  assert.equal(tasks(result.extracted).length, 0);
  assert.deepEqual(
    tasks(result.source).map((b) => b.id),
    ["task", "other"],
  );
  assert.deepEqual(
    leaves(result.extracted).map((b) => b.id),
    ["continuation"],
  );
});
test("disjoint selected leaves retain document order and leave only one link", () => {
  const result = extractDocContent(
    fixture(),
    ["outside", "task", "other"],
    link,
  );
  assert.deepEqual(
    leaves(result.extracted).map((b) => b.id),
    ["task", "other", "outside"],
  );
  assert.equal(leaves(result.source).filter((b) => b.id === "link").length, 1);
});
test("flat extraction preserves its format and refuses stale selections", () => {
  const value: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", id: "a", text: "A" },
      { type: "paragraph", id: "b", text: "B" },
    ],
  };
  assert.deepEqual(extractDocContent(value, ["b"], link), {
    source: { format: 1, blocks: [value.blocks[0], link] },
    extracted: { format: 1, blocks: [value.blocks[1]] },
  });
  for (const ids of [[], ["missing"], ["a", "missing"]])
    assert.throws(() => extractDocContent(value, ids, link), /changed/);
});
test("ordered extraction starts at the first selected item and retains marker style", () => {
  const value: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers(
      "7) First ^first\n8) Second ^second\n9) Third ^third",
      { anchors: true },
    ),
  };
  const result = extractDocContent(value, ["second"], link);
  const list = (result.extracted as any).nodes[0];
  assert.equal(list.start, 8);
  assert.equal(list.delimiter, ")");
});
