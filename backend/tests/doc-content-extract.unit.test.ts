import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractDocContent as extractWithContext,
  parseDocContainers,
  docContainerBlocks,
  docContainerTaskBlocks,
  docReferenceLinks,
  parseDocInline,
  footnoteTexts,
  type VersionedDocContent,
  type DocBlock,
} from "@orbyn/core";
const sourceId = "00000000-0000-4000-8000-000000000002";
const destinationId = "00000000-0000-4000-8000-000000000001";
const extractDocContent = (
  value: VersionedDocContent,
  ids: string[],
  link: DocBlock,
) => {
  let index = 0;
  return extractWithContext(value, ids, link, {
    sourceId,
    destinationId,
    freshId: () => `anchor-${++index}`,
  });
};
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

test("extraction relocates local and explicit source links in both directions", () => {
  const value: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers(
      `> ## Moved ^moved\n> [kept](#kept) [self](#moved) [explicit](orbyn://doc/${sourceId}#moved) ^moved-links\n\n## Kept ^kept\n[follow](#moved) [stay](#kept) [explicit](orbyn://doc/${sourceId}#moved) ^kept-links`,
      { anchors: true },
    ),
  };
  const before = structuredClone(value);
  const result = extractDocContent(value, ["moved", "moved-links"], link);
  const moved = leaves(result.extracted).find((b) => b.id === "moved-links")!;
  const kept = leaves(result.source).find((b) => b.id === "kept-links")!;
  assert.equal(
    "text" in moved && moved.text,
    `[kept](orbyn://doc/${sourceId}#kept) [self](#moved) [explicit](orbyn://doc/${destinationId}#moved)`,
  );
  assert.equal(
    "text" in kept && kept.text,
    `[follow](orbyn://doc/${destinationId}#moved) [stay](#kept) [explicit](orbyn://doc/${destinationId}#moved)`,
  );
  assert.deepEqual(value, before);
});

test("moved links to anonymous source headings retain the exact heading through stable anchors", () => {
  const value: VersionedDocContent = {
    format: 1,
    blocks: [
      {
        type: "paragraph",
        id: "move",
        text: "[slug](#heading) [position](#h-1) [unknown](#missing) `[literal](#heading)`",
      },
      { type: "heading", level: 2, text: "Heading" },
      { type: "code", lang: "md", text: "[literal](#heading)" },
    ],
  };
  const result = extractDocContent(value, ["move"], link);
  const heading = leaves(result.source).find((b) => b.type === "heading")!;
  assert.equal(heading.id, "anchor-1");
  const moved = leaves(result.extracted)[0];
  assert.equal(
    "text" in moved && moved.text,
    `[slug](orbyn://doc/${sourceId}#anchor-1) [position](orbyn://doc/${sourceId}#anchor-1) [unknown](#missing) \`[literal](#heading)\``,
  );
  assert.ok(
    leaves(result.source).some(
      (b) => b.type === "code" && b.text === "[literal](#heading)",
    ),
  );
  assert.equal(value.blocks[1].id, undefined);
});

test("extraction refuses invalid pages and generated anchors that collide with stored owners", () => {
  const value: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers(
      "> ## Heading\n^anchor-1\n\n[Heading](#heading) ^move",
      { anchors: true },
    ),
  };
  assert.throws(
    () =>
      extractWithContext(value, ["move"], link, {
        sourceId,
        destinationId,
        freshId: () => "anchor-1",
      }),
    /already used/,
  );
  assert.throws(
    () =>
      extractWithContext(value, ["move"], link, {
        sourceId,
        destinationId: sourceId,
        freshId: () => "fresh",
      }),
    /identity/,
  );
  assert.throws(
    () =>
      extractWithContext(value, ["move"], link, {
        sourceId: "invalid",
        destinationId,
        freshId: () => "fresh",
      }),
    /identity/,
  );
});

test("extraction carries transitive references and footnotes with fresh copy identities", () => {
  const value: VersionedDocContent = {
    format: 2,
    nodes: [
      {
        kind: "quote",
        children: [
          {
            kind: "block",
            block: {
              type: "paragraph",
              id: "move",
              text: "Read [**Guide**][guide] and note[^n]",
            },
          },
        ],
      },
      {
        kind: "block",
        block: {
          type: "paragraph",
          id: "guide-definition",
          text: '[guide]: https://guide.test "Guide title"',
        },
      },
      {
        kind: "block",
        block: {
          type: "footnote",
          id: "note-n",
          label: "n",
          text: "Nested note[^m] and [guide] and [Heading](#kept)",
        },
      },
      {
        kind: "block",
        block: {
          type: "footnote",
          id: "note-m",
          label: "m",
          text: "Cycle back[^n]",
        },
      },
      {
        kind: "block",
        block: { type: "heading", id: "kept", level: 2, text: "Kept" },
      },
      {
        kind: "block",
        block: {
          type: "paragraph",
          id: "unused",
          text: "[unused]: https://unused.test",
        },
      },
    ],
  };
  const before = structuredClone(value),
    result = extractDocContent(value, ["move"], link);
  const moved = leaves(result.extracted),
    refs = docReferenceLinks(moved),
    notes = footnoteTexts(moved);
  assert.equal(refs.get("guide"), "https://guide.test");
  assert.equal(refs.titleFor?.("guide", "https://guide.test"), "Guide title");
  assert.equal(refs.has("unused"), false);
  assert.equal(notes.size, 2);
  assert.equal(
    notes.get("n"),
    `Nested note[^m] and [guide] and [Heading](orbyn://doc/${sourceId}#kept)`,
  );
  assert.equal(notes.get("m"), "Cycle back[^n]");
  assert.equal(moved.length, 4);
  assert.equal(
    moved.some(
      (b) =>
        b.id === "guide-definition" || b.id === "note-n" || b.id === "note-m",
    ),
    false,
  );
  const paragraph = moved[0];
  assert.ok(
    "text" in paragraph &&
      parseDocInline(paragraph.text, refs).some(
        (run) => run.link === "https://guide.test",
      ),
  );
  assert.deepEqual(value, before);
});

test("moving definitions retains copies required by source content without copying literal examples", () => {
  const value: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", id: "stay", text: "[guide] and note[^n]" },
      {
        type: "paragraph",
        id: "definition",
        text: "[guide]: https://guide.test",
      },
      { type: "footnote", id: "note", label: "n", text: "Note text" },
      { type: "code", lang: "md", text: "[unused] [^unused]" },
      {
        type: "paragraph",
        id: "unused-definition",
        text: "[unused]: https://unused.test",
      },
      {
        type: "footnote",
        id: "unused-note",
        label: "unused",
        text: "Unused text",
      },
    ],
  };
  const result = extractDocContent(value, ["definition", "note"], link);
  const kept = leaves(result.source),
    moved = leaves(result.extracted);
  assert.equal(docReferenceLinks(kept).get("guide"), "https://guide.test");
  assert.equal(footnoteTexts(kept).get("n"), "Note text");
  assert.equal(
    kept.some((b) => b.id === "definition" || b.id === "note"),
    false,
  );
  assert.deepEqual(
    moved.map((b) => b.id),
    ["definition", "note"],
  );
  assert.equal(
    moved.some((b) => b.id === "unused-definition" || b.id === "unused-note"),
    false,
  );
});

test("split duplicate definitions retain the original first reference and last footnote bindings", () => {
  const value: VersionedDocContent = {
    format: 1,
    blocks: [
      {
        type: "paragraph",
        id: "first-ref",
        text: '[guide]: https://first.test "First"',
      },
      {
        type: "paragraph",
        id: "later-ref",
        text: '[guide]: https://later.test "Later"',
      },
      { type: "paragraph", id: "move", text: "[guide] and note[^n]" },
      { type: "footnote", id: "earlier-note", label: "n", text: "Earlier" },
      { type: "footnote", id: "last-note", label: "n", text: "Last" },
      { type: "paragraph", id: "stay", text: "[guide] and note[^n]" },
    ],
  };
  const result = extractDocContent(
    value,
    ["later-ref", "move", "earlier-note"],
    link,
  );
  for (const document of [result.source, result.extracted]) {
    const blocks = leaves(document),
      refs = docReferenceLinks(blocks);
    assert.equal(refs.get("guide"), "https://first.test");
    assert.equal(refs.titleFor?.("guide", "https://first.test"), "First");
    assert.equal(footnoteTexts(blocks).get("n"), "Last");
  }
  assert.ok(leaves(result.extracted).some((b) => b.id === "later-ref"));
  assert.ok(leaves(result.extracted).some((b) => b.id === "earlier-note"));
});
