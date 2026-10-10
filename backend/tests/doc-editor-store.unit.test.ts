import { test } from "node:test";
import assert from "node:assert/strict";
import { DocEditorStore } from "@orbyn/api-client";
import {
  parseDocContainers,
  type Doc,
  type VersionedDocContent,
} from "@orbyn/core";

const id = "00000000-0000-4000-8000-000000000001";
const document: VersionedDocContent = {
  format: 2,
  nodes: parseDocContainers("> - [ ] First ^first\n\nTail ^tail", {
    anchors: true,
  }),
};
const page = (version = 1, value = document): Doc =>
  ({
    id,
    version,
    title: "Page",
    document: value,
    content: [],
    updated_at: "2026-10-10T00:00:00.000Z",
  }) as unknown as Doc;

test("full editor store saves one ownership tree with the page title", async () => {
  let sent: unknown;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async (_id, value) => {
      sent = value;
      return { ...page(2, value.document), title: value.title ?? "Page" };
    },
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  const owner = store.state.session!.document;
  store.changeTitle("Page", "Edited");
  store.changeOperation(owner, {
    kind: "replace-leaf",
    path: [0, 0, 0, 0],
    block: { type: "paragraph", id: "first", text: "Changed" },
  });
  await store.save();
  assert.equal((sent as { title: string }).title, "Edited");
  assert.equal((sent as { document: VersionedDocContent }).document.format, 2);
  assert.equal(store.state.session?.saved.version, 2);
  assert.equal(store.state.error, null);
});

test("invalid source and conflicting remote revision retain the local draft", async () => {
  let remote = page();
  const store = new DocEditorStore({
    getDocForEditor: async () => remote,
    updateDocForEditor: async () => {
      throw Object.assign(new Error("Conflict"), { statusCode: 409 });
    },
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  const owner = store.state.session!.document;
  store.changeSource(owner, "> - [ ] One ^first\n\nTail ^first");
  assert.equal(store.state.source, "> - [ ] One ^first\n\nTail ^first");
  assert.ok(store.state.error);
  store.changeSource(owner, "> - [ ] Changed ^first\n\nTail ^tail");
  assert.equal(store.state.error, null);
  remote = page(2, {
    format: 2,
    nodes: parseDocContainers("> - [ ] Remote ^first\n\nTail ^tail", {
      anchors: true,
    }),
  });
  await store.save();
  assert.equal(store.state.conflict, true);
  assert.equal(store.state.session?.saved.version, 1);
  assert.equal(store.state.session?.document.format, 2);
});

test("refresh keeps an invalid source buffer and refuses a silent historical overwrite", async () => {
  let remote = page();
  const store = new DocEditorStore({
    getDocForEditor: async () => remote,
    updateDocForEditor: async () => remote,
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  const owner = store.state.session!.document;
  store.changeSource(owner, "> - [ ] One ^first\n\nTail ^first");
  remote = page(2);
  await store.refresh();
  assert.equal(store.state.conflict, true);
  assert.equal(store.state.source, "> - [ ] One ^first\n\nTail ^first");
  assert.equal(store.state.session?.saved.version, 1);
  assert.throws(() => store.adopt(remote), /Save or discard/);
});
