import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendDocContainerBlocks,
  appendDocContainerSection,
  docContainerSectionBlocks,
  parseDocContainers,
  serializeDocContainers,
  type DocContainerNode,
} from "@orbyn/core";

const heading = {
  type: "heading" as const,
  level: 2 as const,
  text: "Notes",
  id: "agenda-notes",
};
const added = [
  { type: "paragraph" as const, id: "added", text: "Captured words" },
];
const nested = () =>
  parseDocContainers(
    "> [!NOTE]\n> Keep this **quote** ^quote-leaf\n>\n> - list ^list-leaf\n>\n>   ```mermaid\n>   graph TD; A-->B\n>   ```\n^quote-owner",
    { anchors: true },
  );

test("root capture preserves complete nested content and caller ownership", () => {
  const nodes = nested(),
    before = structuredClone(nodes);
  const next = appendDocContainerBlocks(nodes, added);
  assert.deepEqual(next.slice(0, -1), before);
  assert.deepEqual(nodes, before);
  assert.deepEqual(next.at(-1), { kind: "block", block: added[0] });
  added[0].text = "Changed caller object";
  assert.equal((next.at(-1) as any).block.text, "Captured words");
  added[0].text = "Captured words";
  assert.match(serializeDocContainers(next, { anchors: true }), /quote-owner/);
});
test("only a blank root leaf is replaced; an empty nested owner remains intact", () => {
  const blank: DocContainerNode = {
    kind: "block",
    block: { type: "paragraph", text: "" },
  };
  assert.equal(appendDocContainerBlocks([blank], added).length, 1);
  const owner: DocContainerNode = {
    kind: "quote",
    id: "empty-owner",
    children: [blank],
  };
  assert.deepEqual(appendDocContainerBlocks([owner], added)[0], owner);
});
test("section append preserves nested owners and trailing blanks before the next root heading", () => {
  const nodes: DocContainerNode[] = [
    { kind: "block", block: heading },
    ...nested(),
    { kind: "block", block: { type: "paragraph", text: "" } },
    { kind: "block", block: { type: "heading", level: 2, text: "Reflection" } },
  ];
  const next = appendDocContainerSection(nodes, heading, added, {
    stopAtAnyHeading: true,
  });
  assert.deepEqual(next.slice(0, nodes.length - 2), nodes.slice(0, -2));
  assert.deepEqual(next.at(-3), { kind: "block", block: added[0] });
  assert.deepEqual(next.slice(-2), nodes.slice(-2));
});
test("nested heading names do not become page-root destinations", () => {
  const nodes = parseDocContainers("> ## Notes\n> Existing quotation", {
    anchors: true,
  });
  const next = appendDocContainerSection(nodes, heading, added);
  assert.deepEqual(next[0], nodes[0]);
  assert.deepEqual(next[1], { kind: "block", block: heading });
});
test("named root heading wins; unnamed agenda notes uses the last matching heading", () => {
  const nodes = parseDocContainers("## Notes\nFirst\n\n## Notes\nSecond");
  const next = appendDocContainerSection(nodes, heading, added, {
    last: true,
    stopAtAnyHeading: true,
  });
  assert.equal((next.at(-1) as any).block.id, "added");
  const named = structuredClone(nodes);
  (named[0] as any).block.id = "agenda-notes";
  const chosen = appendDocContainerSection(named, heading, added, {
    last: true,
    stopAtAnyHeading: true,
  });
  assert.equal((chosen[2] as any).block.id, "added");
});
test("reflection includes deeper root subsections while notes stops at every root heading", () => {
  const nodes = parseDocContainers(
    "## Notes\nA\n\n### Detail\nB\n\n## Next\nC",
  );
  const notes = appendDocContainerSection(nodes, heading, added, {
    stopAtAnyHeading: true,
  });
  assert.equal((notes[2] as any).block.id, "added");
  const reflection = appendDocContainerSection(nodes, heading, added);
  assert.equal((reflection[4] as any).block.id, "added");
});
test("invalid or colliding additions reject without mutating the source", () => {
  const nodes = nested(),
    before = structuredClone(nodes);
  assert.throws(() =>
    appendDocContainerBlocks(nodes, [
      { type: "paragraph", text: "collision", id: "quote-leaf" },
    ]),
  );
  assert.throws(() =>
    appendDocContainerBlocks(nodes, [{ type: "unknown" } as any]),
  );
  assert.deepEqual(nodes, before);
});

test("root section reads ignore incidental nested headings and retain nested section text", () => {
  const nodes = parseDocContainers(
    "> ## Reflection\n> Unrelated\n\n## Reflection\nFirst\n\n> ## Incidental\n> Kept\n\n### Detail\nSecond\n\n## Next\nExcluded",
  );
  const blocks = docContainerSectionBlocks(nodes, "Reflection");
  const texts = blocks.flatMap((block) =>
    "text" in block ? [block.text] : [],
  );
  assert.deepEqual(texts, ["First", "Incidental", "Kept", "Detail", "Second"]);
  assert.deepEqual(docContainerSectionBlocks(nodes, "Missing"), []);
});

test("a nested reserved section ID remains owned and does not collide with a new root section", () => {
  const nodes = parseDocContainers("> ## Notes ^agenda-notes\n> Nested notes", {
    anchors: true,
  });
  const next = appendDocContainerSection(nodes, heading, added);
  assert.deepEqual(next[0], nodes[0]);
  assert.equal((next[1] as any).block.id, undefined);
  assert.equal((next[1] as any).block.text, "Notes");
});
