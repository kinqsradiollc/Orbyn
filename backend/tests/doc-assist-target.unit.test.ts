import { test } from "node:test";
import assert from "node:assert/strict";
import { DocEditorStore, prepareDocAssistTarget } from "@orbyn/api-client";
import {
  docContainerBlocks,
  type Doc,
  type DocBlock,
  type VersionedDocContent,
} from "@orbyn/core";

async function fixture(format: 1 | 2, anchored = false) {
  const blocks: DocBlock[] = [
    { type: "paragraph", text: "Repeated passage" },
    {
      type: "paragraph",
      text: "Repeated passage",
      ...(anchored ? { id: "target" } : {}),
    },
  ];
  let document: VersionedDocContent =
    format === 1
      ? { format, blocks }
      : {
          format,
          nodes: [
            {
              kind: "quote",
              children: blocks.map((block) => ({ kind: "block", block })),
            },
          ],
        };
  let version = 1,
    anchors = 0;
  const page = () =>
    ({
      id: "page",
      version,
      title: "Page",
      content: [],
      document,
      updated_at: "2026-10-15T00:00:00.000Z",
    }) as unknown as Doc;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () => page(),
  });
  await store.open("page");
  const leaves = () => {
    const value = store.state.session!.document;
    return value.format === 1 ? value.blocks : docContainerBlocks(value.nodes);
  };
  const client = {
    anchorLine: async (_id: string, index: number, text: string) => {
      anchors++;
      assert.equal(index, 1);
      assert.equal(text, "Repeated passage");
      const named = { ...blocks[1], id: "target" };
      document =
        format === 1
          ? { format, blocks: [blocks[0], named] }
          : {
              format,
              nodes: [
                {
                  kind: "quote",
                  children: [blocks[0], named].map((block) => ({
                    kind: "block",
                    block,
                  })),
                },
              ],
            };
      version++;
      return { block_id: "target" };
    },
  };
  return { store, client, leaves, anchors: () => anchors };
}
for (const format of [1, 2] as const) {
  test(`format ${format} names the exact saved duplicate before asking, preserving containment`, async () => {
    const f = await fixture(format);
    const result = await prepareDocAssistTarget(
      f.store,
      f.client,
      "page",
      f.leaves()[1],
      () => true,
    );
    assert.equal(result.id, "target");
    assert.equal(f.anchors(), 1);
    assert.equal(f.leaves()[0].id, undefined);
    assert.equal(f.store.state.session!.document.format, format);
    assert.equal(f.store.state.session!.saved.version, 2);
  });
}
test("saved anchored targets do not add a revision", async () => {
  const f = await fixture(2, true);
  assert.equal(
    (
      await prepareDocAssistTarget(
        f.store,
        f.client,
        "page",
        f.leaves()[1],
        () => true,
      )
    ).id,
    "target",
  );
  assert.equal(f.anchors(), 0);
});
test("dirty source and stale or guessed targets cannot name a passage", async () => {
  const f = await fixture(2),
    target = f.leaves()[1];
  await assert.rejects(
    prepareDocAssistTarget(
      f.store,
      f.client,
      "page",
      { ...target },
      () => true,
    ),
    /selected text changed/,
  );
  await assert.rejects(
    prepareDocAssistTarget(f.store, f.client, "page", target, () => false),
    /Save or resolve/,
  );
  f.store.changeTitle("Page", "Unsent title");
  await assert.rejects(
    prepareDocAssistTarget(f.store, f.client, "page", target, () => true),
    /Save or resolve/,
  );
  assert.equal(f.anchors(), 0);
});
test("account switch during anchoring cannot refresh or open the old passage", async () => {
  const f = await fixture(2);
  let active = true,
    refreshes = 0;
  const client = {
    anchorLine: async () => {
      active = false;
      return { block_id: "target" };
    },
  };
  const store = {
    get state() {
      return f.store.state;
    },
    refresh: async () => {
      refreshes++;
    },
  };
  await assert.rejects(
    prepareDocAssistTarget(store, client, "page", f.leaves()[1], () => active),
    /account or page changed/,
  );
  assert.equal(refreshes, 0);
});
test("newer draft during anchoring is retained without refresh", async () => {
  const f = await fixture(2);
  const client = {
    anchorLine: async () => {
      f.store.changeTitle("Page", "Newer draft");
      return { block_id: "target" };
    },
  };
  await assert.rejects(
    prepareDocAssistTarget(f.store, client, "page", f.leaves()[1], () => true),
    /Save or resolve/,
  );
  assert.equal(f.store.state.session!.title, "Newer draft");
});
