import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPublishedBlocks, pagePublicationInput } from "@orbyn/core";
import { PagePublicationStore } from "@orbyn/api-client";
import type { Doc, PagePublication } from "@orbyn/core";

const blocks = [
  { id: "chosen", type: "paragraph", text: "Public words" },
  { id: "private", type: "paragraph", text: "Private words" },
];
test("publication scope preserves nesting without publishing siblings or newly added blocks", () => {
  const source = {
    format: 2,
    nodes: [
      {
        kind: "quote",
        children: blocks.map((block) => ({ kind: "block", block })),
      },
    ],
  };
  const selected = selectPublishedBlocks(source, ["chosen"]);
  assert.deepEqual(selected, {
    format: 2,
    nodes: [{ kind: "quote", children: [{ kind: "block", block: blocks[0] }] }],
  });
  assert.equal(JSON.stringify(selected).includes("Private words"), false);
  assert.equal(source.nodes[0].children.length, 2);
});
test("missing or duplicated publication selection fails closed", () => {
  for (const ids of [["missing"], ["chosen", "chosen"]])
    assert.throws(() => selectPublishedBlocks({ format: 1, blocks }, ids));
});
test("publication requires explicit consent, fixed scope and revision fences", () => {
  const input = {
    expected_doc_version: 1,
    expected_revision: 0,
    block_ids: ["chosen"],
    mode: "snapshot",
    expires_at: null,
    consent: true,
  };
  assert.equal(pagePublicationInput.safeParse(input).success, true);
  for (const change of [
    { consent: false },
    { block_ids: [] },
    { expected_doc_version: 0 },
    { mode: "automatic" },
  ])
    assert.equal(
      pagePublicationInput.safeParse({ ...input, ...change }).success,
      false,
    );
});

type Api = ConstructorParameters<typeof PagePublicationStore>[0];
const doc = { id: "page", version: 1, title: "Page", content: blocks } as Doc;
const publication: PagePublication = {
  revision: 1,
  mode: "snapshot",
  block_ids: ["chosen"],
  path: "/s/test",
  expires_at: null,
  source_version: 1,
};
const api = (changes: Partial<Api> = {}): Api => ({
  getDocForEditor: async () => doc,
  updateDocForEditor: async () => doc,
  getPagePublication: async () => publication,
  publishPageSelection: async () => publication,
  revokePagePublication: async () => ({ ok: true }),
  getPublish: async () => ({ published: null, via_folder: null }),
  unpublish: async () => ({ ok: true }),
  ...changes,
});
test("sharing account switch discards all private state during an in-flight operation", async () => {
  let account = "one";
  let finish!: () => void;
  const store = new PagePublicationStore(
    api({
      revokePagePublication: () =>
        new Promise((resolve) => {
          finish = () => resolve({ ok: true });
        }),
    }),
    "page",
    () => account,
    () => {},
  );
  await store.prepare();
  assert.equal(store.getSnapshot().doc, doc);
  const pending = store.revoke();
  account = "two";
  finish();
  await pending;
  const state = store.getSnapshot();
  assert.equal(state.doc, null);
  assert.equal(state.publication, null);
  assert.deepEqual(state.selected, []);
  assert.equal(state.busy, false);
});
test("sharing effect replay can reload after disposal without reviving an obsolete request", async () => {
  let calls = 0;
  let finish!: (doc: Doc) => void;
  const store = new PagePublicationStore(
    api({
      getDocForEditor: async () =>
        calls++
          ? doc
          : new Promise((resolve) => {
              finish = resolve;
            }),
    }),
    "page",
    () => "one",
    () => {},
  );
  const obsolete = store.prepare();
  store.dispose();
  await store.prepare();
  finish({ ...doc, title: "Obsolete" });
  await obsolete;
  assert.equal(store.getSnapshot().doc?.title, "Page");
  assert.equal(store.getSnapshot().busy, false);
});
