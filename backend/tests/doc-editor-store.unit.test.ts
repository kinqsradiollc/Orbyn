import { test } from "node:test";
import assert from "node:assert/strict";
import { DocEditorStore } from "@orbyn/api-client";
import { canLeaveStructuredDocDraft } from "../../mobile/src/features/documents/editor/structuredDocDraftGuard.js";
import {
  DocContentFormatError,
  docEditorSessionDirty,
  parseDocContainers,
  versionedDocSource,
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

test("title changes cannot clear an invalid source or send its old tree", async () => {
  let sent = 0;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () => {
      sent++;
      return page(2);
    },
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  const owner = store.state.session!.document;
  const invalid = "> - [ ] One ^first\n\nTail ^first";
  store.changeSource(owner, invalid);
  store.changeTitle("Page", "Renamed");
  await store.save();
  assert.equal(sent, 0);
  assert.equal(store.state.source, invalid);
  assert.equal(store.state.sourceInvalid, true);
  assert.ok(store.state.error);
  store.changeSource(owner, "> - [ ] One ^first\n\nTail ^tail");
  await store.save();
  assert.equal(sent, 1);
  assert.equal(store.state.sourceInvalid, false);
});

test("an earlier save receipt cannot erase invalid source typed while it was in flight", async () => {
  let settle!: (doc: Doc) => void;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () =>
      new Promise<Doc>((resolve) => {
        settle = resolve;
      }),
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  store.changeTitle("Page", "First edit");
  const saving = store.save();
  const owner = store.state.session!.document;
  const invalid = "> - [ ] One ^first\n\nTail ^first";
  store.changeSource(owner, invalid);
  settle({ ...page(2), title: "First edit" });
  await saving;
  assert.equal(store.state.source, invalid);
  assert.equal(store.state.sourceInvalid, true);
  assert.ok(store.state.error);
  assert.equal(store.state.session?.saved.version, 2);
});

test("an offline failure cannot replace newer invalid source with an acknowledged old tree", async () => {
  let rejectSave!: (error: Error) => void;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () =>
      new Promise<Doc>((_resolve, reject) => {
        rejectSave = reject;
      }),
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  store.changeTitle("Page", "First edit");
  const saving = store.save();
  const owner = store.state.session!.document;
  const invalid = "> - [ ] One ^first\n\nTail ^first";
  store.changeSource(owner, invalid);
  const validationError = store.state.error;
  rejectSave(Object.assign(new Error("Offline"), { offline: true }));
  await saving;
  assert.equal(store.state.source, invalid);
  assert.equal(store.state.sourceInvalid, true);
  assert.equal(store.state.error, validationError);
  store.acknowledgeOfflineSave();
  assert.equal(store.state.error, validationError);
  assert.equal(store.state.session?.saved.version, 1);
  assert.equal(canLeaveStructuredDocDraft(store.state, true), false);
});

test("a failed conflict refresh keeps the newer invalid source error", async () => {
  let reads = 0;
  let rejectSave!: (error: Error) => void;
  const store = new DocEditorStore({
    getDocForEditor: async () => {
      if (reads++ === 0) return page();
      throw Object.assign(new Error("Offline"), { offline: true });
    },
    updateDocForEditor: async () =>
      new Promise<Doc>((_resolve, reject) => {
        rejectSave = reject;
      }),
  } as ConstructorParameters<typeof DocEditorStore>[0]);
  await store.open(id);
  store.changeTitle("Page", "First edit");
  const saving = store.save();
  const owner = store.state.session!.document;
  const invalid = "> - [ ] One ^first\n\nTail ^first";
  store.changeSource(owner, invalid);
  const validationError = store.state.error;
  rejectSave(Object.assign(new Error("Conflict"), { statusCode: 409 }));
  await saving;
  assert.equal(store.state.source, invalid);
  assert.equal(store.state.sourceInvalid, true);
  assert.equal(store.state.error, validationError);
  assert.equal(canLeaveStructuredDocDraft(store.state, true), false);
});

test("explicit retry saves a retained failed draft without another edit", async () => {
  let calls = 0;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async (_id, input) => {
      if (++calls === 1) throw new TypeError("Failed to fetch");
      return { ...page(2, input.document), title: input.title ?? "Page" };
    },
  });
  await store.open(id);
  store.changeTitle("Page", "Retained draft");
  await store.save();
  assert.ok(store.state.error);
  await store.save();
  assert.equal(calls, 1, "ordinary autosave does not loop on the failure");
  await store.retrySave();
  assert.equal(calls, 2);
  assert.equal(store.state.error, null);
  assert.equal(store.state.session?.title, "Retained draft");
  assert.equal(store.state.session?.saved.version, 2);
});
test("explicit retry never sends invalid source", async () => {
  let calls = 0;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () => {
      calls++;
      return page(2);
    },
  });
  await store.open(id);
  store.changeSource(
    store.state.session!.document,
    "> - [ ] One ^first\n\nTail ^first",
  );
  const error = store.state.error;
  await store.retrySave();
  assert.equal(calls, 0);
  assert.equal(store.state.error, error);
  assert.equal(store.state.sourceInvalid, true);
});

test("explicit retry preserves a conflicting draft for review", async () => {
  let reads = 0,
    writes = 0;
  const store = new DocEditorStore({
    getDocForEditor: async () =>
      ++reads === 1 ? page() : { ...page(2), title: "Remote title" },
    updateDocForEditor: async () => {
      writes++;
      throw Object.assign(new Error("Conflict"), { statusCode: 409 });
    },
  });
  await store.open(id);
  store.changeTitle("Page", "Local title");
  await store.save();
  assert.equal(store.state.conflict, true);
  await store.retrySave();
  assert.equal(writes, 1);
  assert.equal(store.state.session?.title, "Local title");
  assert.equal(store.state.conflict, true);
});

test("complete document replacement retains agenda metadata that Markdown cannot round-trip", async () => {
  const agenda: VersionedDocContent = {
    format: 1,
    blocks: [
      { type: "heading", level: 2, text: "Action items", id: "agenda_heading" },
      {
        type: "todo",
        text: "Prepare the report",
        done: false,
        depth: 0,
        id: "agenda_task",
      },
      { type: "paragraph", text: "Keep these notes", id: "agenda_notes" },
    ],
  };
  assert.throws(
    () => versionedDocSource(agenda, { projected: true }),
    /cannot preserve/,
  );
  let sent: VersionedDocContent | undefined;
  const store = new DocEditorStore({
    getDocForEditor: async () => ({ ...page(1, agenda), kind: "agenda" }),
    updateDocForEditor: async (_id, input) => {
      sent = input.document;
      return {
        ...page(2, input.document),
        title: input.title ?? "Page",
        kind: "agenda",
      };
    },
  });
  await store.open(id);
  const opened = store.state.session!;
  const replacement = structuredClone(agenda);
  if (replacement.format !== 1 || replacement.blocks[1].type !== "todo")
    assert.fail("Expected legacy agenda");
  replacement.blocks[1].text = "Prepare the complete report";
  replacement.blocks[1].done = true;
  const accepted = structuredClone(replacement);
  assert.equal(store.changeDocument(opened.document, replacement), true);
  assert.deepEqual(store.state.session?.document, accepted);
  assert.equal(store.state.session?.saved, opened.saved);
  assert.equal(store.state.source, null);
  assert.equal(store.state.sourceInvalid, false);
  assert.equal(store.state.error, null);
  replacement.blocks[1].text = "Caller changed its array";
  assert.deepEqual(
    store.state.session?.document,
    accepted,
    "the accepted tree owns its data",
  );
  await store.save();
  assert.deepEqual(sent, accepted);
  assert.deepEqual(store.state.session?.saved.document, accepted);
  assert.equal(store.state.session?.saved.version, 2);
});

test("complete document replacement preserves nested owner metadata and empty identities", async () => {
  const nested: VersionedDocContent = {
    format: 2,
    nodes: [
      {
        kind: "quote",
        id: "outer_owner",
        callout: { tone: "note", folded: true },
        children: [
          {
            kind: "list",
            id: "agenda_list",
            ordered: true,
            start: 5,
            delimiter: ")",
            loose: true,
            items: [
              {
                checked: false,
                children: [
                  {
                    kind: "block",
                    block: {
                      type: "paragraph",
                      id: "nested_note",
                      text: "Before",
                    },
                  },
                ],
              },
              { children: [] },
            ],
          },
          { kind: "quote", id: "empty_owner", children: [] },
        ],
      },
    ],
  };
  const store = new DocEditorStore({
    getDocForEditor: async () => page(1, nested),
    updateDocForEditor: async (_id, input) => ({
      ...page(2, input.document),
      title: input.title ?? "Page",
    }),
  });
  await store.open(id);
  const replacement = structuredClone(nested);
  if (
    replacement.format !== 2 ||
    replacement.nodes[0].kind !== "quote" ||
    replacement.nodes[0].children[0].kind !== "list"
  )
    assert.fail("Expected nested list owner");
  const item = replacement.nodes[0].children[0].items[0];
  if (
    item.children[0].kind !== "block" ||
    item.children[0].block.type !== "paragraph"
  )
    assert.fail("Expected named paragraph");
  item.children[0].block.text = "After";
  assert.equal(
    store.changeDocument(store.state.session!.document, replacement),
    true,
  );
  assert.deepEqual(store.state.session?.document, replacement);
  await store.save();
  assert.deepEqual(store.state.session?.saved.document, replacement);
});

test("complete document replacement clears valid Markdown only after an accepted tree", async () => {
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () => page(2),
  });
  await store.open(id);
  store.changeSource(
    store.state.session!.document,
    "> - [ ] Typed ^first\n\nTail ^tail",
  );
  assert.notEqual(store.state.source, null);
  const current = store.state.session!.document;
  assert.equal(store.changeDocument(current, current), true);
  assert.equal(store.state.source, null);
  assert.equal(store.state.sourceInvalid, false);
  assert.equal(store.state.error, null);
});

test("stale, invalid and format-changing complete replacements keep draft, raw source and baseline", async () => {
  const cases = ["stale", "invalid", "format"] as const;
  for (const kind of cases) {
    const store = new DocEditorStore({
      getDocForEditor: async () => page(),
      updateDocForEditor: async () => page(2),
    });
    await store.open(id);
    const original = store.state.session!.document;
    const raw = "> - [ ] Local ^first\n\nTail ^tail";
    store.changeSource(original, raw);
    const before = store.state;
    const candidate: VersionedDocContent =
      kind === "format"
        ? {
            format: 1,
            blocks: [{ type: "paragraph", id: "legacy", text: "Flat" }],
          }
        : kind === "invalid"
          ? ({
              format: 2,
              nodes: [{ kind: "unknown" }],
            } as unknown as VersionedDocContent)
          : before.session!.document;
    assert.equal(
      store.changeDocument(
        kind === "stale" ? original : before.session!.document,
        candidate,
      ),
      false,
      kind,
    );
    assert.equal(store.state.session, before.session, kind);
    assert.equal(store.state.session?.saved, before.session?.saved, kind);
    assert.equal(store.state.source, raw, kind);
    assert.equal(store.state.sourceInvalid, false, kind);
    assert.ok(store.state.error instanceof Error, kind);
    if (kind !== "invalid")
      assert.ok(store.state.error instanceof DocContentFormatError, kind);
    assert.match(
      (store.state.error as Error).message,
      kind === "stale"
        ? /document changed/
        : kind === "format"
          ? /content format/
          : /document|node|container/i,
    );
  }
  const legacy: VersionedDocContent = {
    format: 1,
    blocks: [{ type: "paragraph", id: "legacy", text: "Before" }],
  };
  const store = new DocEditorStore({
    getDocForEditor: async () => page(1, legacy),
    updateDocForEditor: async () => page(2, legacy),
  });
  await store.open(id);
  const before = store.state.session;
  assert.equal(
    store.changeDocument(before!.document, document),
    false,
    "format1 to format2 also requires explicit migration",
  );
  assert.equal(store.state.session, before);
  assert.ok(store.state.error instanceof DocContentFormatError);
});

test("complete replacement refuses unavailable, invalid, failed and conflicting editors without changing their state", async () => {
  const empty = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () => page(2),
  });
  const unopened = empty.state;
  assert.equal(empty.changeDocument(document, document), false);
  assert.equal(empty.state, unopened);

  await empty.open(id);
  empty.changeSource(
    empty.state.session!.document,
    "first ^duplicate\n\nsecond ^duplicate",
  );
  const invalid = empty.state;
  assert.equal(invalid.sourceInvalid, true);
  assert.equal(
    empty.changeDocument(invalid.session!.document, document),
    false,
  );
  assert.equal(empty.state, invalid);

  const failed = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await failed.open(id);
  failed.changeTitle("Page", "Unsaved");
  await failed.save();
  const error = failed.state;
  assert.ok(error.error);
  assert.equal(failed.changeDocument(error.session!.document, document), false);
  assert.equal(failed.state, error);

  let reads = 0;
  const conflict = new DocEditorStore({
    getDocForEditor: async () =>
      reads++ ? { ...page(2), title: "Remote title" } : page(),
    updateDocForEditor: async () => page(2),
  });
  await conflict.open(id);
  conflict.changeTitle("Page", "Local title");
  await conflict.refresh();
  const disputed = conflict.state;
  assert.equal(disputed.conflict, true);
  assert.equal(
    conflict.changeDocument(disputed.session!.document, document),
    false,
  );
  assert.equal(conflict.state, disputed);
});

test("serialized save keeps a newer complete tree and its validation error until explicit retry", async () => {
  let settle!: (doc: Doc) => void;
  let writes = 0;
  let firstSent: { title?: string; document: VersionedDocContent } | undefined;
  const store = new DocEditorStore({
    getDocForEditor: async () => page(),
    updateDocForEditor: async (_id, input) => {
      if (++writes === 1) {
        firstSent = input;
        return new Promise<Doc>((resolve) => {
          settle = resolve;
        });
      }
      return { ...page(3, input.document), title: input.title ?? "Page" };
    },
  });
  await store.open(id);
  store.changeSource(
    store.state.session!.document,
    "> - [ ] First save ^first\n\nTail ^tail",
  );
  const before = store.state.session!.document;
  const saving = store.save();
  const newer: VersionedDocContent = {
    format: 2,
    nodes: [
      {
        kind: "quote",
        id: "new_owner",
        callout: { tone: "tip", folded: false },
        children: [
          {
            kind: "block",
            block: {
              type: "paragraph",
              id: "new_leaf",
              text: "New tree while save is pending",
            },
          },
        ],
      },
    ],
  };
  assert.equal(store.changeDocument(before, newer), true);
  assert.equal(store.changeDocument(before, document), false);
  const validation = store.state.error;
  assert.ok(validation instanceof DocContentFormatError);
  await store.save();
  assert.equal(writes, 1, "an in-flight save still serializes the transport");
  settle({
    ...page(2, firstSent!.document),
    title: firstSent!.title ?? "Page",
  });
  await saving;
  assert.deepEqual(store.state.session?.document, newer);
  assert.deepEqual(store.state.session?.saved.document, firstSent!.document);
  assert.equal(store.state.session?.saved.version, 2);
  assert.equal(
    store.state.error,
    validation,
    "complete replacement advances the newer-edit receipt fence",
  );
  assert.equal(store.state.source, null);
  assert.equal(docEditorSessionDirty(store.state.session!), true);
  await store.retrySave();
  assert.equal(writes, 2);
  assert.deepEqual(store.state.session?.saved.document, newer);
  assert.equal(store.state.session?.saved.version, 3);
  assert.equal(store.state.error, null);
});
