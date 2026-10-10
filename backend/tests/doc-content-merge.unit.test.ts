import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeDocContents,
  docReferenceLinks,
  parseDocInline,
  parseDocContainers,
  docContainerBlocks,
  serializeDocContainers,
  type VersionedDocContent,
} from "@orbyn/core";
const flat = (text: string, id = "leaf"): VersionedDocContent => ({
  format: 1,
  blocks: [{ type: "paragraph", text, id }],
});
const nested = (): VersionedDocContent => ({
  format: 2,
  nodes: parseDocContainers(
    "> [!NOTE]\n> Nested words ^leaf\n>\n> - [ ] task ^task\n>\n>   ```mermaid\n>   graph TD; A-->B\n>   ```\n^owner",
    { anchors: true },
  ),
});
const ids = () => {
  let n = 0;
  return () => `new-${++n}`;
};
for (const targetFormat of [1, 2] as const)
  for (const sourceFormat of [1, 2] as const) {
    test(`merge ${sourceFormat} into ${targetFormat} retains complete owners and promotes only when required`, () => {
      const target = targetFormat === 2 ? nested() : flat("Target");
      const source = sourceFormat === 2 ? nested() : flat("Source");
      const before = structuredClone({ target, source });
      const merged = mergeDocContents(target, source, "Source page", ids());
      assert.equal(
        merged.document.format,
        sourceFormat === 2 || targetFormat === 2 ? 2 : 1,
      );
      assert.equal(
        merged.renamed.get("leaf"),
        targetFormat === 2 && sourceFormat === 2 ? "new-2" : "new-1",
      );
      assert.deepEqual({ target, source }, before);
      if (merged.document.format === 2) {
        const roots = merged.document.nodes;
        assert.deepEqual(
          roots[0],
          targetFormat === 2
            ? (target as any).nodes[0]
            : { kind: "block", block: (target as any).blocks[0] },
        );
        if (sourceFormat === 2) {
          const tail = roots.at(-1) as any;
          assert.equal(tail.kind, "quote");
          assert.deepEqual(tail.callout, { tone: "note", folded: false });
          assert.match(serializeDocContainers([tail]), /graph TD; A-->B/);
          assert.match(serializeDocContainers([tail]), /\[ \] task/);
          assert.equal(
            tail.id,
            targetFormat === 2 ? merged.renamed.get("owner") : "owner",
          );
        }
        const allIds = docContainerBlocks(roots).flatMap((block) =>
          block.id ? [block.id] : [],
        );
        assert.equal(new Set(allIds).size, allIds.length);
      }
    });
  }
test("empty nested owners and nested blank leaves are retained; only blank root paragraphs are dropped", () => {
  const source: VersionedDocContent = {
    format: 2,
    nodes: [
      { kind: "block", block: { type: "paragraph", text: "" } },
      {
        kind: "quote",
        id: "empty-owner",
        children: [
          {
            kind: "block",
            block: { type: "paragraph", text: "", id: "empty-leaf" },
          },
        ],
      },
    ],
  };
  const result = mergeDocContents(flat("Target"), source, "", ids());
  assert.deepEqual((result.document as any).nodes.at(-1), source.nodes[1]);
  assert.equal((result.document as any).nodes.length, 2);
});
test("first heading retains its place and avoids a duplicate title heading", () => {
  const source: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers("> ## Heading\n> Text"),
  };
  const result = mergeDocContents(flat("Target"), source, "Title", ids());
  assert.equal((result.document as any).nodes.length, 2);
  assert.deepEqual((result.document as any).nodes[1], source.nodes[0]);
});
test("generated IDs must not collide with destination, later source IDs, or each other", () => {
  for (const generated of ["leaf", "later", "bad id", ""]) {
    const source: VersionedDocContent = {
      format: 1,
      blocks: [
        { type: "paragraph", id: "leaf", text: "First" },
        { type: "paragraph", id: "later", text: "Later" },
      ],
    };
    assert.throws(() =>
      mergeDocContents(flat("Target"), source, "Title", () => generated),
    );
    assert.equal(source.blocks[0].id, "leaf");
  }
  assert.throws(() =>
    mergeDocContents(nested(), nested(), "Title", () => "same-new-id"),
  );
});
test("unknown structured fields fail instead of silently flattening", () => {
  assert.throws(() =>
    mergeDocContents(
      flat("Target"),
      { format: 2, nodes: [{ kind: "unknown", children: [] }] } as any,
      "",
      ids(),
    ),
  );
});

test("merged nested local links follow renamed leaves, preserving titles and literal examples", () => {
  const source: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers(
      '> ## Source ^leaf\n> [read](#leaf "Title") and `[literal](#leaf)` and \\[escaped](#leaf) ^links\n>\n> [ref]: <#leaf> "Reference title"\n>\n> ```md\n> [code](#leaf)\n> ```',
      { anchors: true },
    ),
  };
  const before = structuredClone(source);
  const result = mergeDocContents(flat("Target"), source, "", ids());
  const blocks =
    result.document.format === 2
      ? docContainerBlocks(result.document.nodes)
      : result.document.blocks;
  const id = result.renamed.get("leaf")!;
  const link = blocks.find((b) => b.id === "links")!;
  assert.equal(
    "text" in link && link.text,
    `[read](#${id} "Title") and \`[literal](#leaf)\` and \\[escaped](#leaf)`,
  );
  assert.ok(
    blocks.some(
      (b) => "text" in b && b.text === `[ref]: <#${id}> "Reference title"`,
    ),
  );
  assert.ok(
    blocks.some((b) => b.type === "code" && b.text === "[code](#leaf)"),
  );
  assert.deepEqual(source, before);
});

test("heading slugs and exported positions resolve to source headings after merge", () => {
  const target: VersionedDocContent = {
    format: 1,
    blocks: [{ type: "heading", level: 1, text: "Heading" }],
  };
  const source: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[slug](#heading) [position](#h-1)" },
      { type: "heading", level: 2, text: "Heading" },
    ],
  };
  const result = mergeDocContents(target, source, "Source page", ids());
  if (result.document.format !== 1) throw new Error("Wrong format");
  const heading = result.document.blocks.at(-1)!;
  assert.ok(heading.id);
  assert.equal(
    (result.document.blocks[2] as any).text,
    `[slug](#${heading.id}) [position](#${heading.id})`,
  );
  assert.equal(target.blocks[0].id, undefined);
});

test("named empty leaves survive merge and keep their fragment destinations", () => {
  const source: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", id: "empty", text: "" },
      { type: "paragraph", text: "[empty](#empty) [missing](#missing)" },
    ],
  };
  const result = mergeDocContents(flat("Target"), source, "", ids());
  if (result.document.format !== 1) throw new Error("Wrong format");
  assert.ok(result.document.blocks.some((b) => b.id === "empty"));
  assert.equal(
    (result.document.blocks.at(-1) as any).text,
    "[empty](#empty) [missing](#missing)",
  );
});

test("reference and footnote collisions retain the moved page's definitions and literal examples", () => {
  const target: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: '[same]: https://target.test "Target title"' },
      { type: "paragraph", text: "Target [same] and note[^n]" },
      { type: "footnote", label: "n", text: "Target note" },
    ],
  };
  const source: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers(
      '> [same]: https://source.test "Source title"\n>\n> [**Guide**][same] [same][] [same] and note[^n] and `[same] [^n]`\n>\n> [^n]: Source note\n>\n> ```md\n> [same] [^n]\n> ```',
    ),
  };
  const before = structuredClone({ target, source });
  const result = mergeDocContents(target, source, "", ids());
  if (result.document.format !== 2)
    throw new Error("Missing structured result");
  const blocks = docContainerBlocks(result.document.nodes);
  assert.deepEqual(blocks.slice(0, 3), target.blocks);
  const moved = blocks.slice(3);
  assert.ok(
    moved.some(
      (b) =>
        "text" in b &&
        b.text === '[merged-reference-1]: https://source.test "Source title"',
    ),
  );
  assert.ok(
    moved.some(
      (b) =>
        "text" in b &&
        b.text ===
          "[**Guide**][merged-reference-1] [same][merged-reference-1] [same][merged-reference-1] and note[^merged-note-1] and `[same] [^n]`",
    ),
  );
  assert.ok(
    moved.some(
      (b) =>
        b.type === "footnote" &&
        b.label === "merged-note-1" &&
        b.text === "Source note",
    ),
  );
  assert.ok(moved.some((b) => b.type === "code" && b.text === "[same] [^n]"));
  assert.deepEqual({ target, source }, before);
});

test("identical reference definitions can share a label; generated labels avoid both pages", () => {
  const target: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[same]: https://same.test" },
      {
        type: "paragraph",
        text: "[merged-reference-1]: https://occupied.test",
      },
    ],
  };
  const identical: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[same]: https://same.test" },
      { type: "paragraph", text: "[same]" },
    ],
  };
  const shared = mergeDocContents(target, identical, "", ids());
  if (shared.document.format !== 1) throw new Error("Wrong format");
  assert.equal((shared.document.blocks.at(-1) as any).text, "[same]");
  const other: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[same]: https://other.test" },
      { type: "paragraph", text: "[same]" },
    ],
  };
  const renamed = mergeDocContents(target, other, "", ids());
  if (renamed.document.format !== 1) throw new Error("Wrong format");
  assert.equal(
    (renamed.document.blocks.at(-1) as any).text,
    "[same][merged-reference-2]",
  );
});

test("merging preserves unresolved reference text on both pages instead of activating links", () => {
  const target: VersionedDocContent = {
    format: 1,
    blocks: [
      {
        type: "paragraph",
        id: "target-text",
        text: "[**Source**][source-ref] and [source-ref]",
      },
      { type: "paragraph", text: "[target-ref]: https://target.test" },
    ],
  };
  const source: VersionedDocContent = {
    format: 2,
    nodes: parseDocContainers(
      "> [**Target**][target-ref] and [target-ref] and `[target-ref]` ^source-text\n>\n> [source-ref]: https://source.test",
      { anchors: true },
    ),
  };
  const originals = [target.blocks[0], docContainerBlocks(source.nodes)[0]];
  const before = structuredClone({ target, source });
  const result = mergeDocContents(target, source, "", ids());
  if (result.document.format !== 2) throw new Error("Missing nested result");
  const blocks = docContainerBlocks(result.document.nodes),
    references = docReferenceLinks(blocks);
  for (const original of originals) {
    const moved = blocks.find((b) => b.id === original.id)!;
    if (!("text" in original) || !("text" in moved))
      throw new Error("Missing text");
    const beforeRuns = parseDocInline(original.text),
      afterRuns = parseDocInline(moved.text, references);
    assert.equal(
      afterRuns.map((run) => run.text).join(""),
      beforeRuns.map((run) => run.text).join(""),
    );
    assert.equal(afterRuns.filter((run) => run.link).length, 0);
    assert.match(moved.text, /\\\[/);
  }
  assert.deepEqual({ target, source }, before);
});

test("generated reference labels avoid unresolved shortcuts and dangling footnotes stay unbound", () => {
  const target: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[same]: https://target.test" },
      { type: "paragraph", text: "Unbound note[^n]" },
    ],
  };
  const source: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[same]: https://source.test" },
      {
        type: "paragraph",
        text: "[same] and [merged-reference-1] and note[^n]",
      },
      { type: "footnote", label: "n", text: "Source note" },
    ],
  };
  const result = mergeDocContents(target, source, "", ids());
  if (result.document.format !== 1) throw new Error("Wrong format");
  const blocks = result.document.blocks;
  assert.equal((blocks[1] as any).text, "Unbound note[^n]");
  assert.ok(
    blocks.some(
      (b) =>
        "text" in b &&
        b.text ===
          "[same][merged-reference-2] and [merged-reference-1] and note[^merged-note-1]",
    ),
  );
  assert.ok(
    blocks.some((b) => b.type === "footnote" && b.label === "merged-note-1"),
  );
  assert.equal(
    blocks.some((b) => b.type === "footnote" && b.label === "n"),
    false,
  );
});

test("unsafe destination definitions cannot suppress valid moved source references", () => {
  const target: VersionedDocContent = {
    format: 1,
    blocks: [{ type: "paragraph", text: "[same]: javascript:alert(1)" }],
  };
  const source: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "paragraph", text: "[same]: https://source.test" },
      { type: "paragraph", text: "[same]" },
    ],
  };
  const result = mergeDocContents(target, source, "", ids());
  if (result.document.format !== 1) throw new Error("Wrong format");
  const blocks = result.document.blocks,
    refs = docReferenceLinks(blocks);
  const text = (blocks.at(-1) as any).text;
  assert.equal(text, "[same][merged-reference-1]");
  assert.equal(
    parseDocInline(text, refs).find((run) => run.link)?.link,
    "https://source.test",
  );
  assert.equal(refs.has("same"), false);
});
