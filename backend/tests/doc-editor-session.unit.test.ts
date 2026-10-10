import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptDocEditorSave,
  docEditorSessionDirty,
  editDocEditorSession,
  openDocEditorSession,
  parseDocContainers,
  prepareDocEditorSave,
  reconcileDocEditorSession,
  sourceDocEditorSession,
  titleDocEditorSession,
  versionedDocSource,
  type DocEditorRevision,
  type DocEditorSession,
  type VersionedDocContent,
} from "@orbyn/core";

const fixture = (): DocEditorRevision => ({
  id: "page",
  version: 3,
  title: "Page",
  document: {
    format: 2,
    nodes: parseDocContainers(
      "> - [ ] First ^first\n> - Second ^second\n\nTail ^tail",
      { anchors: true },
    ),
  },
});
const edit = (state: DocEditorSession, text: string) =>
  editDocEditorSession(state, state.document, {
    kind: "replace-leaf",
    path: [0, 0, 0, 0],
    block: { type: "paragraph", id: "first", text },
  });
const receipt = (state: DocEditorSession): DocEditorRevision => ({
  ...prepareDocEditorSave(state),
  version: state.saved.version + 1,
});

test("editor session detaches and freezes complete ownership, including empty owners", () => {
  const input = fixture();
  if (input.document.format !== 2) throw new Error("Expected owner tree");
  input.document.nodes.push({ kind: "quote", children: [] });
  const session = openDocEditorSession(input);
  const snapshot = JSON.stringify(session);
  input.document.nodes.pop();
  assert.equal(JSON.stringify(session), snapshot);
  assert.throws(() => {
    if (session.document.format === 2) session.document.nodes.pop();
  }, TypeError);
  assert.equal(docEditorSessionDirty(session), false);
});

test("rich leaf edits retain parents and produce detached immutable save tickets", () => {
  const state = openDocEditorSession(fixture());
  const changed = edit(state, "Typed");
  const ticket = prepareDocEditorSave(changed);
  assert.match(versionedDocSource(ticket.document), /> - \[ \] Typed \^first/);
  assert.equal(ticket.version, 3);
  assert.equal(docEditorSessionDirty(changed), true);
  assert.notEqual(ticket.document, changed.document);
  assert.match(versionedDocSource(state.document), /First/);
});

test("saved receipt advances one revision and marks the exact draft clean", () => {
  const state = edit(openDocEditorSession(fixture()), "Typed");
  const settled = acceptDocEditorSave(
    state,
    prepareDocEditorSave(state),
    receipt(state),
  );
  assert.equal(settled.saved.version, 4);
  assert.equal(docEditorSessionDirty(settled), false);
});

test("typing and title changes during an in-flight save survive its receipt", () => {
  const sent = edit(openDocEditorSession(fixture()), "Sent");
  const ticket = prepareDocEditorSave(sent);
  const later = titleDocEditorSession(
    edit(sent, "Still typing"),
    sent.title,
    "Local title",
  );
  const settled = acceptDocEditorSave(later, ticket, receipt(sent));
  assert.match(versionedDocSource(settled.document), /Still typing/);
  assert.equal(settled.title, "Local title");
  assert.equal(settled.saved.title, "Page");
  assert.equal(docEditorSessionDirty(settled), true);
  const next = prepareDocEditorSave(settled);
  assert.equal(next.version, 4);
  assert.match(versionedDocSource(next.document), /Still typing/);
});

test("server task ticks merge into newer disjoint typing without flattening", () => {
  const sent = openDocEditorSession(fixture());
  const ticket = prepareDocEditorSave(sent);
  const later = edit(sent, "Still typing");
  // A plain list item cannot acquire a checkbox through a tick command.
  assert.throws(() =>
    editDocEditorSession(sent, sent.document, {
      kind: "check-item",
      list: [0, 0],
      item: 1,
      checked: true,
    }),
  );
  const firstTick = editDocEditorSession(sent, sent.document, {
    kind: "check-item",
    list: [0, 0],
    item: 0,
    checked: true,
  });
  const settled = acceptDocEditorSave(later, ticket, receipt(firstTick));
  assert.match(versionedDocSource(settled.document), /> - \[x\] Still typing/);
  assert.equal(settled.saved.version, 4);
});

test("a local changed checklist tick survives a receipt that kept the sent tick", () => {
  const sent = openDocEditorSession(fixture());
  const later = editDocEditorSession(sent, sent.document, {
    kind: "check-item",
    list: [0, 0],
    item: 0,
    checked: true,
  });
  const settled = acceptDocEditorSave(
    later,
    prepareDocEditorSave(sent),
    receipt(sent),
  );
  assert.match(versionedDocSource(settled.document), /\[x\]/);
  assert.equal(docEditorSessionDirty(settled), true);
});

test("wrong page, stale, duplicate and flattened receipts refuse without changing the draft", () => {
  const state = edit(openDocEditorSession(fixture()), "Keep");
  const ticket = prepareDocEditorSave(state);
  const saved = receipt(state);
  const before = JSON.stringify(state);
  for (const bad of [
    { ...saved, id: "other" },
    { ...saved, version: 3 },
    { ...saved, version: 5 },
    { ...saved, document: { format: 1, blocks: [] } as VersionedDocContent },
  ])
    assert.throws(() => acceptDocEditorSave(state, ticket, bad));
  const accepted = acceptDocEditorSave(state, ticket, saved);
  assert.throws(() => acceptDocEditorSave(accepted, ticket, saved));
  assert.equal(JSON.stringify(state), before);
});

test("reconcile merges disjoint named leaf edits into their original quote/list owners", () => {
  const opened = openDocEditorSession(fixture());
  const local = edit(opened, "Local");
  const remote = editDocEditorSession(opened, opened.document, {
    kind: "replace-leaf",
    path: [1],
    block: { type: "paragraph", id: "tail", text: "Remote" },
  });
  const merged = reconcileDocEditorSession(local, receipt(remote));
  const source = versionedDocSource(merged.document);
  assert.match(source, /> - \[ \] Local/);
  assert.match(source, /Remote \^tail/);
  assert.equal(docEditorSessionDirty(merged), true);
});

test("overlapping remote content or titles preserve the entire local draft on refusal", () => {
  const opened = openDocEditorSession(fixture());
  const local = titleDocEditorSession(
    edit(opened, "Local"),
    "Page",
    "Local title",
  );
  const before = JSON.stringify(local);
  assert.throws(() =>
    reconcileDocEditorSession(local, receipt(edit(opened, "Remote"))),
  );
  assert.throws(() =>
    reconcileDocEditorSession(local, {
      ...receipt(opened),
      title: "Remote title",
    }),
  );
  assert.equal(JSON.stringify(local), before);
});

test("same revision is idempotent only for the exact server baseline", () => {
  const opened = openDocEditorSession(fixture());
  const local = edit(opened, "Local");
  assert.equal(reconcileDocEditorSession(local, fixture()), local);
  assert.throws(() =>
    reconcileDocEditorSession(local, { ...fixture(), title: "Changed" }),
  );
  assert.throws(() =>
    reconcileDocEditorSession(local, { ...fixture(), version: 2 }),
  );
  assert.throws(() =>
    reconcileDocEditorSession(local, { ...fixture(), id: "other" }),
  );
});

test("a same-format save receipt cannot flatten, reorder or change list ownership", () => {
  const state = edit(openDocEditorSession(fixture()), "Keep");
  const ticket = prepareDocEditorSave(state);
  const saved = receipt(state);
  const before = JSON.stringify(state);
  for (const text of [
    "Keep ^first\n\nSecond ^second\n\nTail ^tail",
    "> - Second ^second\n> - [ ] Keep ^first\n\nTail ^tail",
    "> 1. [ ] Keep ^first\n> 2. Second ^second\n\nTail ^tail",
  ]) {
    const document: VersionedDocContent = {
      format: 2,
      nodes: parseDocContainers(text, { anchors: true }),
    };
    assert.throws(() =>
      acceptDocEditorSave(state, ticket, { ...saved, document }),
    );
  }
  assert.equal(JSON.stringify(state), before);
});

test("stale source, rich command and title handlers cannot overwrite a newer draft", () => {
  const opened = openDocEditorSession(fixture());
  const newer = titleDocEditorSession(
    edit(opened, "Newer"),
    "Page",
    "Newer title",
  );
  assert.throws(() =>
    sourceDocEditorSession(newer, opened.document, opened.document),
  );
  assert.throws(() =>
    editDocEditorSession(newer, opened.document, {
      kind: "remove",
      path: [1],
    }),
  );
  assert.throws(() => titleDocEditorSession(newer, "Page", "Old title"));
  assert.match(versionedDocSource(newer.document), /Newer/);
});

test("legacy ownership stays legacy until an explicit full-source conversion", () => {
  const state = openDocEditorSession({
    id: "legacy",
    version: 1,
    title: "Legacy",
    document: {
      format: 1,
      blocks: [{ type: "paragraph", id: "first", text: "Legacy" }],
    },
  });
  const renamed = titleDocEditorSession(state, "Legacy", "Title");
  assert.equal(prepareDocEditorSave(renamed).document.format, 1);
  const upgraded = sourceDocEditorSession(
    renamed,
    renamed.document,
    fixture().document,
  );
  assert.equal(prepareDocEditorSave(upgraded).document.format, 2);
  assert.equal(state.document.format, 1);
});

test("invalid ownership never becomes an empty draft or flat fallback", () => {
  const valid = fixture();
  for (const document of [
    { format: 99, blocks: [] },
    { format: 2, nodes: [{ kind: "unknown" }] },
    { format: 1, blocks: [], nodes: [] },
  ])
    assert.throws(() =>
      openDocEditorSession({ ...valid, document: document as never }),
    );
});
