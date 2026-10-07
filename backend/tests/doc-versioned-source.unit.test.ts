import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDocContainers,
  versionedDocSourceMap,
  versionedDocLeafSourceMap,
  docSourceBlockAt,
  versionedDocSourceAt,
  applyVersionedDocSource,
  versionedDocSource,
  parseVersionedDocContent,
  versionedDocContentKey,
} from "@orbyn/core";
const document = {
  format: 2 as const,
  nodes: parseDocContainers(
    "> # Heading ^heading\n>\n> - Words ^words\n>\n>   ```ts\n>   code();\n>   ```\n^quote",
    { anchors: true },
  ),
};

test("nested source ranges retain container paths, leaf order and stable anchors", () => {
  const map = versionedDocSourceMap(document);
  const heading = map.ranges.find((range) => range.id === "heading")!;
  const words = map.ranges.find((range) => range.id === "words")!;
  assert.deepEqual(heading.path, [0, 0]);
  assert.deepEqual(words.path, [0, 1, 0, 0]);
  assert.equal(heading.blockIndex, 0);
  assert.equal(words.blockIndex, 1);
  assert.equal(
    versionedDocSourceAt(map, map.source.indexOf("Words"))?.id,
    "words",
  );
  assert.equal(
    versionedDocSourceAt(map, map.source.indexOf("code();"))?.blockIndex,
    2,
  );
  assert.equal(
    versionedDocSourceAt(map, map.source.indexOf("^quote"))?.id,
    "quote",
  );
});

test("raw CRLF source is mapped only to exactly matching ownership and metadata", () => {
  const source = versionedDocSource(document).replaceAll("\n", "\r\n");
  const map = versionedDocSourceMap(document, source);
  assert.equal(map.source, source);
  assert.equal(versionedDocSourceAt(map, source.indexOf("Words"))?.id, "words");
  assert.throws(
    () => versionedDocSourceMap(document, source.replace("Words", "Different")),
    /do not match/,
  );
  assert.throws(
    () =>
      versionedDocSourceMap(document, source.replace("- Words", "1. Words")),
    /do not match/,
  );
});

test("source edits preserve nested ownership and fence newer reconciliations", () => {
  const source = versionedDocSource(document);
  const next = applyVersionedDocSource(
    document,
    document,
    source.replace("Words", "Changed"),
  );
  assert.match(versionedDocSource(next), /Changed/);
  assert.throws(
    () => applyVersionedDocSource(next, document, source),
    /changed while source/,
  );
  const equivalent = JSON.parse(JSON.stringify(document));
  assert.equal(
    versionedDocContentKey(
      applyVersionedDocSource(document, equivalent, source),
    ),
    versionedDocContentKey(document),
  );
});

test("legacy source remains format1 and metadata-lossy source switching refuses", () => {
  const legacy = {
    format: 1 as const,
    blocks: [{ type: "paragraph" as const, id: "legacy", text: "Words" }],
  };
  const map = versionedDocSourceMap(legacy);
  assert.equal(map.ranges[0].id, "legacy");
  assert.equal(applyVersionedDocSource(legacy, legacy, map.source).format, 1);
  const impossible = {
    format: 2,
    nodes: [
      {
        kind: "list",
        ordered: false,
        start: 1,
        delimiter: "-",
        loose: false,
        items: [
          {
            children: [
              { kind: "block", block: { type: "paragraph", text: "A" } },
              { kind: "block", block: { type: "paragraph", text: "B" } },
            ],
          },
        ],
      },
    ],
  };
  assert.throws(() => versionedDocSourceMap(impossible), /cannot preserve/);
});

test("privacy-expanded source uses read bounds while stored validation remains strict", () => {
  const text = "Private page ".repeat(1000).trim();
  const projected = {
    format: 2,
    nodes: [
      {
        kind: "quote",
        id: "quote",
        children: [
          { kind: "block", block: { type: "paragraph", id: "words", text } },
        ],
      },
    ],
  };
  assert.throws(() => versionedDocSourceMap(projected));
  const map = versionedDocSourceMap(projected, undefined, { projected: true });
  assert.equal(
    versionedDocSourceAt(map, map.source.indexOf("Private page"))?.id,
    "words",
  );
  const accepted = applyVersionedDocSource(projected, projected, map.source, {
    projected: true,
  });
  assert.throws(() => parseVersionedDocContent(accepted));
  assert.equal(
    versionedDocContentKey(accepted, { projected: true }),
    versionedDocContentKey(projected, { projected: true }),
  );
});

test("empty maps and nonfinite/out-of-range carets are bounded", () => {
  assert.equal(
    versionedDocSourceAt(versionedDocSourceMap({ format: 2, nodes: [] }), 1),
    null,
  );
  const map = versionedDocSourceMap(document);
  assert.ok(versionedDocSourceAt(map, Infinity));
  assert.ok(versionedDocSourceAt(map, -100));
  assert.ok(versionedDocSourceAt(map, 1e9));
});

test("visual leaf edits retain all list ownership and reject missing/ambiguous/replaced identity", async () => {
  const { replaceVersionedDocLeaf, docContainerBlocks } =
    await import("@orbyn/core");
  const leaves = docContainerBlocks(document.nodes);
  const words = leaves.find((block) => block.id === "words")!;
  const next = replaceVersionedDocLeaf(document, "words", {
    ...words,
    text: "Visual edit",
  });
  assert.match(versionedDocSource(next), /> - Visual edit \^words/);
  assert.equal(versionedDocSource(document).includes("Visual edit"), false);
  assert.throws(
    () =>
      replaceVersionedDocLeaf(document, "missing", {
        type: "paragraph",
        id: "missing",
        text: "New",
      }),
    /missing or ambiguous/,
  );
  assert.throws(
    () =>
      replaceVersionedDocLeaf(document, "words", {
        type: "paragraph",
        id: "different",
        text: "New",
      }),
    /cannot change/,
  );
  assert.throws(
    () =>
      replaceVersionedDocLeaf(
        {
          format: 1,
          blocks: [
            { type: "paragraph", id: "same", text: "A" },
            { type: "paragraph", id: "same", text: "B" },
          ],
        },
        "same",
        { type: "paragraph", id: "same", text: "C" },
      ),
    /ambiguous/,
  );
});

test("owned source-pane geometry indexes leaves without losing their enclosing Markdown", () => {
  const full = versionedDocSourceMap(document);
  const map = versionedDocLeafSourceMap(document);
  assert.equal(map.source, full.source);
  assert.equal(map.ranges.length, 3);
  assert.deepEqual(
    map.ranges.map((range) => range.blockIndex),
    [0, 1, 2],
  );
  assert.deepEqual(
    map.ranges.map((range) => range.blockId),
    ["heading", "words", undefined],
  );
  for (const text of ["Heading", "Words", "code();"]) {
    const at = map.source.indexOf(text);
    assert.equal(
      docSourceBlockAt(map, at)?.blockIndex,
      versionedDocSourceAt(full, at)?.blockIndex,
    );
  }
  const crlf = map.source.replaceAll("\n", "\r\n");
  const raw = versionedDocLeafSourceMap(document, crlf);
  assert.equal(raw.source, crlf);
  assert.equal(docSourceBlockAt(raw, crlf.indexOf("Words"))?.blockId, "words");
  assert.throws(
    () =>
      versionedDocLeafSourceMap(document, map.source.replace("Words", "Other")),
    /do not match/,
  );
});
