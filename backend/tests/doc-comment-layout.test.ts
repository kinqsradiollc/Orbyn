import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorComments, threadComments, type DocComment } from "@orbyn/core";

const comment = (id: string, patch: Partial<DocComment> = {}): DocComment => ({
  id,
  doc_id: "doc",
  user_id: "writer",
  author: "Writer",
  body: id,
  block_id: null,
  quote: null,
  range_start: null,
  range_end: null,
  parent_id: null,
  detached: false,
  mentions: [],
  resolved_at: null,
  created_at: "2026-09-21T00:00:00Z",
  ...patch,
});

test("line replies stay with their parent even when the API gives them no block ID", () => {
  const root = comment("root", {
    block_id: "line",
    quote: "Hello",
    range_start: 0,
    range_end: 5,
  });
  const reply = comment("reply", { parent_id: root.id });
  const page = comment("page");
  const { anchored, loose } = anchorComments(
    [reply, page, root],
    [{ id: "line", type: "paragraph", text: "Hello world" }],
  );
  assert.deepEqual(loose, [page]);
  assert.deepEqual(threadComments(anchored.get("line")!), [
    { comment: root, replies: [reply] },
  ]);
});

test("a detached thread moves to page comments with its replies intact", () => {
  const root = comment("root", {
    block_id: "removed",
    detached: true,
    quote: "Old words",
  });
  const reply = comment("reply", { parent_id: root.id });
  const { anchored, loose } = anchorComments([root, reply], []);
  assert.equal(anchored.size, 0);
  assert.deepEqual(threadComments(loose), [
    { comment: root, replies: [reply] },
  ]);
});

test("page-level replies form one thread and orphaned replies remain visible", () => {
  const root = comment("root");
  const reply = comment("reply", { parent_id: root.id });
  const orphan = comment("orphan", { parent_id: "deleted" });
  const { loose } = anchorComments([root, reply, orphan], []);
  assert.deepEqual(threadComments(loose), [
    { comment: root, replies: [reply] },
    { comment: orphan, replies: [] },
  ]);
});
