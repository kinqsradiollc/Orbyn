import { test } from "node:test";
import assert from "node:assert/strict";
import {
  legacyDocContent,
  parseVersionedDocSource,
  versionedDocSource,
  parseVersionedDocContent,
  upgradeDocContent,
  downgradeDocContent,
  requireDocContentCapability,
  DocContentFormatError,
  DocContainerError,
  parseDocContainers,
  type DocBlock,
  type DocContainerNode,
} from "@orbyn/core";

test("existing leaves upgrade and downgrade without reparsing or changing identity", () => {
  const blocks: DocBlock[] = [
    { type: "paragraph", id: "words", text: "- literal > marker" },
    { type: "todo", id: "task", text: "Keep status", done: true, depth: 2 },
    { type: "numbered", id: "number", text: "Keep start", start: 7 },
    { type: "code", id: "code", text: "> literal", lang: "text" },
    {
      type: "image",
      id: "image",
      file: "00000000-0000-4000-8000-000000000001",
      text: "Caption",
      width: 40,
    },
    { type: "footnote", id: "note", label: "source", text: "Evidence" },
  ];
  const legacy = legacyDocContent(blocks);
  const upgraded = upgradeDocContent(legacy);
  assert.deepEqual(upgraded, {
    format: 2,
    nodes: blocks.map((block) => ({ kind: "block", block })),
  });
  assert.deepEqual(downgradeDocContent(upgraded), blocks);
  assert.notEqual(legacy.blocks, blocks);
  assert.notEqual(legacy.blocks[0], blocks[0]);
});

test("nested formats survive JSON storage and remain detached from caller objects", () => {
  const input = {
    format: 2,
    nodes: parseDocContainers("> # Heading\n>\n> - [x] Task\n>   - Child"),
  };
  const read = parseVersionedDocContent(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(read, input);
  assert.equal(read.format, 2);
  if (read.format !== 2) return;
  assert.notEqual(read.nodes, input.nodes);
  assert.notEqual(read.nodes[0], input.nodes[0]);
  assert.deepEqual(upgradeDocContent(read), read);
});

test("downgrade refuses even empty containers instead of flattening or dropping them", () => {
  for (const nodes of [
    parseDocContainers("> Words"),
    parseDocContainers("- Words"),
    [{ kind: "quote", id: "empty", children: [] }],
  ])
    assert.throws(
      () => downgradeDocContent({ format: 2, nodes }),
      DocContentFormatError,
    );
});

test("client capability is explicit and separate from optimistic page revision", () => {
  assert.doesNotThrow(() => requireDocContentCapability(1, [1]));
  assert.doesNotThrow(() => requireDocContentCapability(2, [1, 2]));
  assert.throws(
    () => requireDocContentCapability(2, [1]),
    DocContentFormatError,
  );
  assert.throws(
    () => requireDocContentCapability(1, []),
    DocContentFormatError,
  );
});

test("unknown format, missing or extra envelope fields fail without fallback", () => {
  for (const value of [
    null,
    [],
    {},
    { format: 3, nodes: [] },
    { format: "2", nodes: [] },
    { format: 2 },
    { format: 1 },
    { format: 2, nodes: [], blocks: [] },
    { format: 1, blocks: [], nodes: [] },
  ])
    assert.throws(() => parseVersionedDocContent(value));
});

test("unknown node, item, callout and leaf fields cannot be stripped during a save", () => {
  const validQuote = {
    kind: "quote",
    children: [],
    callout: { tone: "tip", folded: false },
  };
  const validList = {
    kind: "list",
    ordered: false,
    start: 1,
    delimiter: "-",
    loose: false,
    items: [{ children: [] }],
  };
  for (const nodes of [
    [{ ...validQuote, ownership: "hidden" }],
    [{ ...validQuote, callout: { ...validQuote.callout, title: "hidden" } }],
    [{ ...validList, items: [{ children: [], secret: true }] }],
    [
      {
        kind: "block",
        block: { type: "paragraph", text: "words" },
        hidden: true,
      },
    ],
    [
      {
        kind: "block",
        block: { type: "paragraph", text: "words", children: [] },
      },
    ],
  ])
    assert.throws(
      () => parseVersionedDocContent({ format: 2, nodes }),
      DocContentFormatError,
    );
  assert.throws(
    () =>
      legacyDocContent([{ type: "paragraph", text: "words", children: [] }]),
    DocContentFormatError,
  );
});

test("empty, wrong type and duplicate identities fail across container and leaf boundaries", () => {
  for (const id of ["", 12, null, "bad space"])
    assert.throws(() =>
      parseVersionedDocContent({
        format: 2,
        nodes: [{ kind: "quote", id, children: [] }],
      }),
    );
  const legacyEmpty = [{ type: "paragraph" as const, id: "", text: "words" }];
  assert.deepEqual(legacyDocContent(legacyEmpty).blocks, legacyEmpty);
  assert.throws(() => upgradeDocContent(legacyDocContent(legacyEmpty)));
  assert.throws(() =>
    parseVersionedDocContent({
      format: 2,
      nodes: [
        { kind: "block", block: { type: "paragraph", id: "", text: "words" } },
      ],
    }),
  );
  const legacyDuplicates = [
    { type: "paragraph" as const, id: "same", text: "a" },
    { type: "paragraph" as const, id: "same", text: "b" },
  ];
  assert.deepEqual(legacyDocContent(legacyDuplicates).blocks, legacyDuplicates);
  assert.throws(() => upgradeDocContent(legacyDocContent(legacyDuplicates)));
  assert.throws(() =>
    parseVersionedDocContent({
      format: 2,
      nodes: [
        {
          kind: "quote",
          id: "same",
          children: [
            {
              kind: "block",
              block: { type: "paragraph", id: "same", text: "b" },
            },
          ],
        },
      ],
    }),
  );
});

test("cycle, depth and count limits are checked before recursive decoding", () => {
  const cyclic: DocContainerNode = { kind: "quote", children: [] };
  if (cyclic.kind === "quote") cyclic.children.push(cyclic);
  assert.throws(
    () => parseVersionedDocContent({ format: 2, nodes: [cyclic] }),
    DocContainerError,
  );
  let deep: DocContainerNode = {
    kind: "block",
    block: { type: "paragraph", text: "bottom" },
  };
  for (let index = 0; index < 14; index++)
    deep = { kind: "quote", children: [deep] };
  assert.throws(
    () => parseVersionedDocContent({ format: 2, nodes: [deep] }),
    DocContainerError,
  );
  assert.throws(
    () =>
      parseVersionedDocContent({
        format: 2,
        nodes: Array.from({ length: 2001 }, () => ({
          kind: "quote",
          children: [],
        })),
      }),
    DocContainerError,
  );
});

test("invalid typed leaves, markers and task metadata fail decoding", () => {
  for (const nodes of [
    [
      {
        kind: "block",
        block: { type: "code", text: "x".repeat(20001), lang: "text" },
      },
    ],
    [{ kind: "quote", children: [], callout: { tone: "evil", folded: false } }],
    [
      {
        kind: "list",
        ordered: true,
        start: 1,
        delimiter: ">",
        loose: false,
        items: [{ children: [] }],
      },
    ],
    [
      {
        kind: "list",
        ordered: false,
        start: 1,
        delimiter: "-",
        loose: false,
        items: [{ checked: "yes", children: [] }],
      },
    ],
  ])
    assert.throws(() => parseVersionedDocContent({ format: 2, nodes }));
});

test("parsed leaves keep existing defaults without sharing mutable children", () => {
  const read = legacyDocContent([{ type: "code", text: "code" }]);
  assert.deepEqual(read.blocks, [{ type: "code", text: "code", lang: "" }]);
  const input = {
    format: 2,
    nodes: [
      {
        kind: "quote",
        callout: { tone: "tip", folded: true },
        children: [
          { kind: "block", block: { type: "paragraph", text: "words" } },
        ],
      },
    ],
  };
  const parsed = parseVersionedDocContent(input);
  if (parsed.format !== 2 || parsed.nodes[0].kind !== "quote")
    assert.fail("Expected quote");
  parsed.nodes[0].callout!.folded = false;
  parsed.nodes[0].children.length = 0;
  assert.equal(input.nodes[0].callout.folded, true);
  assert.equal(input.nodes[0].children.length, 1);
});

test("source switching round-trips nested typed children and identity in the declared format", () => {
  const content = {
    format: 2,
    nodes: parseDocContainers(
      "> # Heading ^heading\n>\n> - [x] Task\n>\n>   Second paragraph\n>\n>   ```ts\n>   run();\n>   ```\n^outer",
      { anchors: true },
    ),
  };
  assert.deepEqual(
    parseVersionedDocSource(versionedDocSource(content), 2),
    content,
  );
  const legacy = legacyDocContent([
    { type: "paragraph", id: "words", text: "Ordinary words" },
  ]);
  assert.deepEqual(
    parseVersionedDocSource(versionedDocSource(legacy), 1),
    legacy,
  );
});

test("source switching refuses adjacent compatible lists that Markdown would merge", () => {
  const nodes = [
    ...parseDocContainers("- One"),
    ...parseDocContainers("- Two"),
  ];
  assert.throws(
    () => versionedDocSource({ format: 2, nodes }),
    DocContentFormatError,
  );
});

test("source switching refuses tight adjacent paragraphs and unencoded metadata", () => {
  const nodes = parseDocContainers("- One");
  if (nodes[0].kind !== "list") assert.fail("Expected list");
  nodes[0].items[0].children.push({
    kind: "block",
    block: { type: "paragraph", text: "Second paragraph" },
  });
  assert.throws(
    () => versionedDocSource({ format: 2, nodes }),
    DocContentFormatError,
  );
  assert.throws(
    () =>
      versionedDocSource({
        format: 1,
        blocks: [{ type: "math", text: "x^2", check: false }],
      }),
    DocContentFormatError,
  );
});

test("anchored source retains the existing positive math check flag", () => {
  const content = legacyDocContent([
    { type: "math", id: "math", text: "x^2", check: true },
  ]);
  assert.deepEqual(
    parseVersionedDocSource(versionedDocSource(content), 1),
    content,
  );
});
