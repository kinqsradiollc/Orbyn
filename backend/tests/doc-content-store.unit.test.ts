import { test } from "node:test";
import assert from "node:assert/strict";
import { DocContentStore } from "@orbyn/api-client";
import { versionedDocSource, parseDocContainers } from "@orbyn/core";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const document = {
  format: 2 as const,
  nodes: parseDocContainers("> Original ^words", { anchors: true }),
};
const read = (docId = id, version = 1, content = document) => ({
  id: docId,
  title: "Page",
  version,
  document: content,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

test("a delayed read cannot reopen the previous page or clear its successor", async () => {
  const old = deferred<ReturnType<typeof read>>();
  const store = new DocContentStore({
    getDocContent: async (value) => (value === id ? old.promise : read(other)),
    updateDocContent: async () => read(),
  });
  const opening = store.open(id);
  await store.open(other);
  old.resolve(read());
  await opening;
  assert.equal(store.state.read?.id, other);
  store.close();
  assert.equal(store.state.read, null);
});

test("typing during a save stays dirty against the returned revision", async () => {
  const saved = deferred<ReturnType<typeof read>>();
  let sent = document;
  const store = new DocContentStore({
    getDocContent: async () => read(),
    updateDocContent: async (_id, _version, content) => {
      sent = content as typeof document;
      return saved.promise;
    },
  });
  await store.open(id);
  store.changeSource(versionedDocSource(document).replace("Original", "First"));
  const saving = store.save();
  store.changeSource(store.state.source!.replace("First", "Second"));
  saved.resolve(read(id, 2, sent));
  await saving;
  assert.equal(store.state.read?.version, 2);
  assert.equal(store.state.dirty, true);
  assert.match(store.state.source!, /Second/);
  assert.match(versionedDocSource(store.state.draft), /Second/);
});

test("invalid source and stale revisions retain local recovery data without fallback writes", async () => {
  let writes = 0;
  const store = new DocContentStore({
    getDocContent: async () => read(),
    updateDocContent: async () => {
      writes++;
      throw { statusCode: 409 };
    },
  });
  await store.open(id);
  store.changeSource("> " + "x".repeat(480001));
  assert.ok(store.state.error);
  assert.match(versionedDocSource(store.state.draft), /Original/);
  await store.save();
  assert.equal(writes, 0);
  store.changeSource(versionedDocSource(document).replace("Original", "Mine"));
  await store.save();
  assert.equal(store.state.conflict, true);
  assert.match(store.state.source!, /Mine/);
  await store.save();
  assert.equal(writes, 1);
});

test("a saved response cannot replace a new page", async () => {
  const saved = deferred<ReturnType<typeof read>>();
  const store = new DocContentStore({
    getDocContent: async (value) => read(value),
    updateDocContent: async () => saved.promise,
  });
  await store.open(id);
  store.changeSource(versionedDocSource(document).replace("Original", "Edit"));
  const saving = store.save();
  await store.open(other);
  saved.resolve(read(id, 2));
  await saving;
  assert.equal(store.state.read?.id, other);
  assert.equal(store.state.dirty, false);
});

test("refresh preserves typing and exposes a conflicting remote revision separately", async () => {
  const observed = deferred<ReturnType<typeof read>>();
  let reads = 0;
  const store = new DocContentStore({
    getDocContent: async () => (++reads === 1 ? read() : observed.promise),
    updateDocContent: async () => read(),
  });
  await store.open(id);
  const refreshing = store.refresh();
  store.changeSource(versionedDocSource(document).replace("Original", "Mine"));
  const remote = {
    format: 2 as const,
    nodes: parseDocContainers("> Theirs ^words", { anchors: true }),
  };
  observed.resolve(read(id, 2, remote));
  await refreshing;
  assert.equal(store.state.conflict, true);
  assert.equal(store.state.read?.version, 1);
  assert.equal(store.state.remote?.version, 2);
  assert.match(store.state.source!, /Mine/);
  assert.match(versionedDocSource(store.state.draft), /Mine/);
});

test("a failed refresh does not block a valid optimistic save", async () => {
  let reads = 0;
  let writes = 0;
  const store = new DocContentStore({
    getDocContent: async () => {
      if (++reads > 1) throw new Error("Offline");
      return read();
    },
    updateDocContent: async (_id, _version, content) => {
      writes++;
      return { ...read(id, 2), document: content };
    },
  });
  await store.open(id);
  store.changeSource(versionedDocSource(document).replace("Original", "Mine"));
  await store.refresh();
  assert.ok(store.state.observationError);
  assert.equal(store.state.error, null);
  await store.save();
  assert.equal(writes, 1);
  assert.equal(store.state.dirty, false);
});

test("visual edits preserve nested ownership and accepted state cannot be mutated", async () => {
  const store = new DocContentStore({
    getDocContent: async () => read(),
    updateDocContent: async (_id, _version, content) => ({
      ...read(id, 2),
      document: content,
    }),
  });
  await store.open(id);
  assert.throws(() => {
    (store.state.read!.document as typeof document).nodes.length = 0;
  }, TypeError);
  store.changeLeaf("words", { id: "words", type: "paragraph", text: "Visual" });
  assert.equal(store.state.draft?.format, 2);
  assert.equal((store.state.draft as typeof document).nodes[0].kind, "quote");
  assert.match(versionedDocSource(store.state.draft), /> Visual/);
  await store.save();
  assert.equal(store.state.read?.version, 2);
});

test("unsupported Markdown representation keeps every visual node available", async () => {
  const nodes = parseDocContainers("- One");
  if (nodes[0].kind !== "list") assert.fail("Expected list");
  nodes[0].items[0].children.push({
    kind: "block",
    block: { type: "paragraph", text: "Second paragraph" },
  });
  const unsupported = { format: 2 as const, nodes };
  const store = new DocContentStore({
    getDocContent: async () => ({ ...read(), document: unsupported }),
    updateDocContent: async () => read(),
  });
  await store.open(id);
  assert.equal(store.state.source, null);
  assert.ok(store.state.error);
  assert.deepEqual(store.state.draft, unsupported);
});
