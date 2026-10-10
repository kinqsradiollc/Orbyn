import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeVersionedDocContent,
  parseDocContainers,
  docContainerBlocks,
  resolvePageSave,
  withPendingSave,
  combinePageSaves,
  encodePageCache,
  decodePageCache,
  DocContentMergeConflict,
  type Doc,
  type PageSave,
  type VersionedDocContent,
} from "@orbyn/core";
const tree = (
  first = "First",
  second = "Second",
): VersionedDocContent & { format: 2 } => ({
  format: 2,
  nodes: parseDocContainers(
    `> ${first} ^first\n>\n> - ${second} ^second\n^quote`,
    { anchors: true },
  ),
});
const projection = (document: VersionedDocContent) =>
  document.format === 1
    ? document.blocks
    : docContainerBlocks(document.nodes, { projected: true });
const page = (document = tree(), version = 1): Doc =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    title: "Page",
    version,
    content: projection(document),
    document,
  }) as Doc;
const pending = (mine = tree("Local"), base = tree()): PageSave => ({
  id: page().id,
  title: "Page",
  content: projection(mine),
  document: mine,
  base: {
    version: 1,
    title: "Page",
    content: projection(base),
    document: base,
  },
});

test("offline merge retains nested ownership and disjoint stable-leaf edits", () => {
  const base = tree(),
    mine = tree("Local"),
    remote = tree("First", "Remote");
  const before = [base, mine, remote].map((value) => JSON.stringify(value));
  const next = mergeVersionedDocContent(base, mine, remote);
  assert.deepEqual(next, tree("Local", "Remote"));
  assert.deepEqual(
    [base, mine, remote].map((value) => JSON.stringify(value)),
    before,
  );
  const resolved = resolvePageSave(pending(mine, base), page(remote, 2));
  assert.deepEqual(resolved.document, next);
  assert.deepEqual(resolved.content, projection(next));
  assert.equal(resolved.version, 2);
});

test("single-sided structural changes and matching echoes retain the complete authored tree", () => {
  const base = tree(),
    mine = tree("Local");
  mine.nodes.push({ kind: "quote", children: [] });
  assert.deepEqual(mergeVersionedDocContent(base, mine, base), mine);
  assert.deepEqual(mergeVersionedDocContent(base, base, mine), mine);
  assert.deepEqual(mergeVersionedDocContent(base, mine, mine), mine);
});

test("overlapping leaves, concurrent structure and anonymous owners refuse without flattening", () => {
  const base = tree(),
    mine = tree("Local"),
    remote = tree("Other");
  assert.throws(
    () => mergeVersionedDocContent(base, mine, remote),
    DocContentMergeConflict,
  );
  remote.nodes.push({ kind: "quote", children: [] });
  assert.throws(
    () => mergeVersionedDocContent(base, mine, remote),
    DocContentMergeConflict,
  );
  const anonymous = (text: string) => ({
    format: 2,
    nodes: [{ kind: "block", block: { type: "paragraph", text } }],
  });
  assert.throws(
    () =>
      mergeVersionedDocContent(
        anonymous("Base"),
        anonymous("Mine"),
        anonymous("Remote"),
      ),
    DocContentMergeConflict,
  );
});

test("offline replay fences missing ownership, mismatched projections and impossible revisions", () => {
  const edit = pending(),
    server = page();
  assert.throws(
    () => resolvePageSave(edit, { ...server, id: "another-page" }),
    /another page/,
  );
  assert.throws(
    () => resolvePageSave({ ...edit, document: undefined }, server),
    /ownership/,
  );
  assert.throws(
    () => resolvePageSave(edit, { ...server, document: undefined }),
    /ownership/,
  );
  assert.throws(
    () => resolvePageSave({ ...edit, content: [] }, server),
    /projection/,
  );
  assert.throws(
    () => resolvePageSave(edit, page(tree("Changed without revision"))),
    DocContentMergeConflict,
  );
  assert.throws(
    () => resolvePageSave(edit, page(tree(), 0)),
    DocContentMergeConflict,
  );
  assert.throws(
    () =>
      resolvePageSave(
        { ...edit, title: "Local title" },
        { ...page(tree(), 2), title: "Remote title" },
      ),
    /title changed/,
  );
});

test("pending overlays and queue coalescing retain full ownership and the original baseline", () => {
  const first = pending(),
    later = pending(tree("Latest"));
  later.base.version = 2;
  const combined = combinePageSaves(first, later);
  assert.deepEqual(combined.base, first.base);
  assert.deepEqual(combined.document, later.document);
  const shown = withPendingSave(page(), combined);
  assert.deepEqual(shown.document, later.document);
  assert.deepEqual(shown.content, projection(later.document!));
  assert.throws(() =>
    combinePageSaves(first, { ...later, id: "another-page" }),
  );
  assert.throws(() =>
    combinePageSaves(first, { ...later, document: undefined }),
  );
});

test("complete page caches round-trip and refuse corrupt ownership or projection", () => {
  const doc = page(),
    entry = { doc, opened_at: 1000 };
  assert.deepEqual(decodePageCache(encodePageCache([entry]), 1001), [entry]);
  for (const document of [null, { format: 99 }, tree("Different")]) {
    const corrupt = { ...entry, doc: { ...doc, document } };
    assert.deepEqual(
      decodePageCache(JSON.stringify({ v: 1, pages: [corrupt] }), 1001),
      [],
    );
  }
  const legacy = { ...doc, document: undefined };
  assert.equal(
    decodePageCache(encodePageCache([{ doc: legacy, opened_at: 1000 }]), 1001)
      .length,
    1,
  );
});

test("legacy pending edits update an explicit format1 projection without carrying stale content", () => {
  const blocks = [{ type: "paragraph" as const, text: "Base" }];
  const doc = {
    ...page(),
    content: blocks,
    document: { format: 1 as const, blocks },
  };
  const edit: PageSave = {
    id: doc.id,
    title: doc.title,
    content: [{ type: "paragraph", text: "Changed" }],
    base: { title: doc.title, version: 1, content: blocks },
  };
  assert.deepEqual(withPendingSave(doc, edit).document, {
    format: 1,
    blocks: edit.content,
  });
  assert.throws(() => withPendingSave(page(), edit), /flat offline edit/);
});

const checklist = (
  first = false,
  second = true,
  text = "First",
): VersionedDocContent & { format: 2 } => ({
  format: 2,
  nodes: parseDocContainers(
    `> - [${first ? "x" : " "}] ${text} ^first\n>   - [${second ? "x" : " "}] Nested ^nested\n> - Plain ^plain`,
    { anchors: true },
  ),
});

test("nested checkbox edits merge with remote text in either direction and replay offline", () => {
  const base = checklist(),
    mine = checklist(true),
    remote = checklist(false, true, "Remote");
  const expected = checklist(true, true, "Remote");
  const before = JSON.stringify([base, mine, remote]);
  assert.deepEqual(mergeVersionedDocContent(base, mine, remote), expected);
  assert.deepEqual(mergeVersionedDocContent(base, remote, mine), expected);
  assert.equal(JSON.stringify([base, mine, remote]), before);
  const save = resolvePageSave(pending(mine, base), page(remote, 2));
  assert.deepEqual(save.document, expected);
  assert.deepEqual(save.content, projection(expected));
  assert.equal(save.version, 2);
});

test("independent parent and child ticks merge without changing plain list items", () => {
  const base = checklist();
  assert.deepEqual(
    mergeVersionedDocContent(base, checklist(true), checklist(false, false)),
    checklist(true, false),
  );
  // Both sides check the same item, and one also edits its text.
  assert.deepEqual(
    mergeVersionedDocContent(
      base,
      checklist(true),
      checklist(true, true, "Edited"),
    ),
    checklist(true, true, "Edited"),
  );
});

test("checkbox merging cannot conceal overlapping text or changed item kinds", () => {
  const base = checklist();
  assert.throws(
    () =>
      mergeVersionedDocContent(
        base,
        checklist(true, true, "Local"),
        checklist(false, true, "Remote"),
      ),
    DocContentMergeConflict,
  );
  const removed = checklist();
  const quote = removed.nodes[0];
  if (quote.kind !== "quote" || quote.children[0].kind !== "list")
    throw new Error("Missing fixture list");
  delete quote.children[0].items[0].checked;
  assert.throws(
    () => mergeVersionedDocContent(base, checklist(true), removed),
    DocContentMergeConflict,
  );
  const reordered = checklist();
  const owner = reordered.nodes[0];
  if (owner.kind !== "quote" || owner.children[0].kind !== "list")
    throw new Error("Missing fixture list");
  owner.children[0].items.reverse();
  assert.throws(
    () => mergeVersionedDocContent(base, checklist(true), reordered),
    DocContentMergeConflict,
  );
});

test("concurrent ticks on empty items without a stable leaf remain conflicts", () => {
  const base = checklist();
  const quote = base.nodes[0];
  if (quote.kind !== "quote" || quote.children[0].kind !== "list")
    throw new Error("Missing fixture list");
  quote.children[0].items[0].children = [];
  const mine = structuredClone(base),
    remote = structuredClone(base);
  const localQuote = mine.nodes[0],
    remoteQuote = remote.nodes[0];
  if (
    localQuote.kind !== "quote" ||
    localQuote.children[0].kind !== "list" ||
    remoteQuote.kind !== "quote" ||
    remoteQuote.children[0].kind !== "list"
  )
    throw new Error("Missing fixture list");
  localQuote.children[0].items[0].checked = true;
  const block = remoteQuote.children[0].items[1].children[0];
  if (block.kind !== "block" || !("text" in block.block))
    throw new Error("Missing text");
  block.block.text = "Remote";
  assert.throws(
    () => mergeVersionedDocContent(base, mine, remote),
    DocContentMergeConflict,
  );
});
