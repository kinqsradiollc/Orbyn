import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDocContentOperation,
  parseVersionedDocContent,
  type DocContainerNode,
} from "@orbyn/core";
const leaf = (id: string): DocContainerNode => ({
  kind: "block",
  block: { type: "paragraph", id, text: id },
});
const fixture = () =>
  parseVersionedDocContent({
    format: 2,
    nodes: [
      {
        kind: "quote",
        id: "quote",
        callout: { tone: "note", folded: true },
        children: [
          {
            kind: "list",
            id: "list",
            ordered: true,
            start: 7,
            delimiter: ")",
            loose: true,
            items: [
              {
                checked: true,
                children: [leaf("first"), leaf("continuation")],
              },
              { checked: false, children: [leaf("second")] },
            ],
          },
        ],
      },
      leaf("outside"),
    ],
  });
const edit = (operation: Parameters<typeof applyDocContentOperation>[2]) => {
  const before = fixture();
  const snapshot = JSON.stringify(before);
  const next = applyDocContentOperation(before, before, operation);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(next.format, 2);
  if (next.format !== 2) throw new Error("Expected structured content");
  return next;
};

test("insert and delete leaves retain quote, list markers and task ownership", () => {
  const next = edit({
    kind: "insert",
    owner: [0, 0, 0],
    index: 1,
    node: leaf("inserted"),
  });
  const quote = next.nodes[0];
  assert.equal(quote.kind, "quote");
  if (quote.kind !== "quote") return;
  assert.deepEqual(quote.callout, { tone: "note", folded: true });
  const list = quote.children[0];
  if (list.kind !== "list") throw new Error("List lost");
  assert.equal(list.start, 7);
  assert.equal(list.delimiter, ")");
  assert.equal(list.loose, true);
  assert.equal(list.items[0].checked, true);
  assert.deepEqual(list.items[0].children, [
    leaf("first"),
    leaf("inserted"),
    leaf("continuation"),
  ]);
  assert.deepEqual(
    applyDocContentOperation(next, next, {
      kind: "remove",
      path: [0, 0, 0, 1],
    }),
    fixture(),
  );
});

test("moving within a list item uses the post-removal destination index", () => {
  const next = edit({
    kind: "move",
    path: [0, 0, 0, 0],
    owner: [0, 0, 0],
    index: 1,
  });
  const quote = next.nodes[0];
  if (quote.kind !== "quote" || quote.children[0].kind !== "list")
    throw new Error("Ownership lost");
  assert.deepEqual(quote.children[0].items[0].children, [
    leaf("continuation"),
    leaf("first"),
  ]);
});

test("moving across owners resolves a destination before root indexes shift", () => {
  const original = fixture();
  if (original.format !== 2) throw new Error("Expected tree");
  original.nodes.unshift(leaf("leading"));
  const next = applyDocContentOperation(original, original, {
    kind: "move",
    path: [0],
    owner: [1, 0, 1],
    index: 1,
  });
  if (
    next.format !== 2 ||
    next.nodes[0].kind !== "quote" ||
    next.nodes[0].children[0].kind !== "list"
  )
    throw new Error("Ownership lost");
  assert.deepEqual(next.nodes[0].children[0].items[1].children, [
    leaf("second"),
    leaf("leading"),
  ]);
});

test("splitting an item retains its continuations and resets only the new task", () => {
  const next = edit({ kind: "split-item", list: [0, 0], item: 0, at: 1 });
  const quote = next.nodes[0];
  if (quote.kind !== "quote" || quote.children[0].kind !== "list")
    throw new Error("Ownership lost");
  assert.deepEqual(quote.children[0].items, [
    { checked: true, children: [leaf("first")] },
    { checked: false, children: [leaf("continuation")] },
    { checked: false, children: [leaf("second")] },
  ]);
});

test("checking an item changes its own state without converting child paragraphs to flat tasks", () => {
  const next = edit({
    kind: "check-item",
    list: [0, 0],
    item: 1,
    checked: true,
  });
  const original = fixture();
  if (
    original.format !== 2 ||
    original.nodes[0].kind !== "quote" ||
    original.nodes[0].children[0].kind !== "list"
  )
    throw new Error("Expected list");
  original.nodes[0].children[0].items[1].checked = true;
  assert.deepEqual(next, original);
});

test("stale paths, malformed positions, duplicate IDs and descendant moves refuse without mutation", () => {
  const original = fixture(),
    snapshot = JSON.stringify(original);
  const invalid = [
    { kind: "move", path: [0], owner: [0, 0, 0], index: 0 },
    { kind: "remove", path: [] },
    { kind: "remove", path: [0, 0, 0, 99] },
    { kind: "insert", owner: [0, 0], index: 0, node: leaf("new") },
    { kind: "insert", owner: [], index: -1, node: leaf("new") },
    { kind: "insert", owner: [], index: 0.5, node: leaf("new") },
    { kind: "insert", owner: [], index: 0, node: leaf("first") },
    { kind: "split-item", list: [0, 0], item: 0, at: 3 },
    { kind: "check-item", list: [0], item: 0, checked: true },
  ] as Parameters<typeof applyDocContentOperation>[2][];
  for (const operation of invalid) {
    assert.throws(() =>
      applyDocContentOperation(original, original, operation),
    );
    assert.equal(JSON.stringify(original), snapshot);
  }
  const next = applyDocContentOperation(original, original, {
    kind: "remove",
    path: [1],
  });
  assert.throws(
    () =>
      applyDocContentOperation(next, original, { kind: "remove", path: [0] }),
    /changed/,
  );
});

test("legacy operations keep format1; nested insertion requires explicit upgrade", () => {
  const original = {
    format: 1,
    blocks: [{ type: "paragraph", id: "old", text: "Old" }],
  };
  const next = applyDocContentOperation(original, original, {
    kind: "insert",
    owner: [],
    index: 1,
    node: leaf("new"),
  });
  assert.deepEqual(next, {
    format: 1,
    blocks: [original.blocks[0], (leaf("new") as { block: unknown }).block],
  });
  assert.throws(
    () =>
      applyDocContentOperation(original, original, {
        kind: "insert",
        owner: [],
        index: 0,
        node: { kind: "quote", children: [leaf("nested")] },
      }),
    /explicit format upgrade/,
  );
});

test("the deepest supported list leaf remains addressable without pruning empty owners", () => {
  let node: DocContainerNode = leaf("deepest");
  for (let n = 0; n < 12; n++)
    node = {
      kind: "list",
      ordered: false,
      start: 1,
      delimiter: "-",
      loose: false,
      items: [{ children: [node] }],
    };
  const original = parseVersionedDocContent({ format: 2, nodes: [node] });
  const next = applyDocContentOperation(original, original, {
    kind: "remove",
    path: Array(25).fill(0),
  });
  assert.equal(next.format, 2);
  assert.notDeepEqual(next, original);
  assert.equal(JSON.stringify(next).includes("deepest"), false);
  assert.equal(JSON.stringify(next).match(/"kind":"list"/g)?.length, 12);
});

test("structural edits retain stored text, depth and ordered marker bounds", () => {
  const before = fixture();
  const large: DocContainerNode = {
    kind: "block",
    block: {
      type: "paragraph",
      id: "large",
      text: "x".repeat(10001),
    },
  };
  assert.throws(() =>
    applyDocContentOperation(before, before, {
      kind: "insert",
      owner: [],
      index: 0,
      node: large,
    }),
  );
  const projected = applyDocContentOperation(
    before,
    before,
    {
      kind: "insert",
      owner: [],
      index: 0,
      node: large,
    },
    { projected: true },
  );
  assert.throws(() => parseVersionedDocContent(projected));
  let deep: DocContainerNode = leaf("deep");
  for (let n = 0; n < 13; n++) deep = { kind: "quote", children: [deep] };
  assert.throws(
    () =>
      applyDocContentOperation(before, before, {
        kind: "insert",
        owner: [],
        index: 0,
        node: deep,
      }),
    /deeply nested/,
  );
  const last = parseVersionedDocContent({
    format: 2,
    nodes: [
      {
        kind: "list",
        ordered: true,
        start: 999999999,
        delimiter: ".",
        loose: false,
        items: [{ children: [leaf("last")] }],
      },
    ],
  });
  assert.throws(
    () =>
      applyDocContentOperation(last, last, {
        kind: "split-item",
        list: [0],
        item: 0,
        at: 1,
      }),
    /list marker/,
  );
});
