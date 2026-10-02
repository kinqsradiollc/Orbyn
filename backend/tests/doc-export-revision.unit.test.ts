import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docExportMatches,
  prepareDocExport,
  type DocExportDraft,
  type DocExportSnapshot,
} from "@orbyn/core";
const saved: DocExportSnapshot = {
  id: "page",
  title: "Page",
  version: 4,
  content: [{ type: "paragraph", text: "Saved", id: "line" }],
};
const copy = (): DocExportSnapshot => structuredClone(saved);
const options = (
  current: () => DocExportDraft,
  confirmed: () => DocExportSnapshot,
  flush = async () => {},
) => ({
  current,
  saved: confirmed,
  flush,
  editable: true,
  signal: new AbortController().signal,
});

test("export content compares structure, not array identity or object key order", () => {
  const draft: DocExportDraft = {
    content: [{ id: "line", text: "Saved", type: "paragraph" }],
    title: "Page",
    id: "page",
  };
  assert.notEqual(draft.content, saved.content);
  assert.equal(docExportMatches(draft, saved), true);
  assert.equal(
    docExportMatches({ ...draft, title: "Unsaved title" }, saved),
    false,
  );
  assert.equal(
    docExportMatches({ ...draft, id: "another-page" }, saved),
    false,
  );
});

test("server-assigned IDs are accepted only for unnamed local blocks", () => {
  assert.ok(
    docExportMatches(
      { ...saved, content: [{ type: "paragraph", text: "Saved" }] },
      saved,
    ),
  );
  assert.equal(
    docExportMatches(
      {
        ...saved,
        content: [{ type: "paragraph", text: "Saved", id: "different" }],
      },
      saved,
    ),
    false,
  );
  assert.equal(
    docExportMatches(
      { ...saved, content: [{ type: "paragraph", text: "Changed" }] },
      saved,
    ),
    false,
  );
});

test("the empty editor placeholder matches a saved empty page but named content does not", () => {
  const empty = { ...saved, content: [] };
  assert.ok(
    docExportMatches(
      { ...saved, content: [{ type: "paragraph", text: "" }] },
      empty,
    ),
  );
  assert.equal(
    docExportMatches(
      { ...saved, content: [{ type: "paragraph", text: "", id: "added" }] },
      empty,
    ),
    false,
  );
});

test("export uses the newly confirmed version after the queued save completes", async () => {
  const current = {
    ...copy(),
    title: "Updated",
    content: [{ type: "paragraph" as const, text: "New text" }],
  };
  let receipt = copy();
  const version = await prepareDocExport(
    options(
      () => current,
      () => receipt,
      async () => {
        receipt = { ...structuredClone(current), version: 5 };
      },
    ),
  );
  assert.equal(version, 5);
});

test("a caught save failure, offline-only edit or speculative CRDT baseline cannot export old content", async () => {
  const current = {
    ...copy(),
    content: [{ type: "paragraph" as const, text: "New draft" }],
  };
  for (const kind of [
    "caught network failure",
    "offline-only save",
    "CRDT baseline",
  ]) {
    let attempts = 0;
    await assert.rejects(
      prepareDocExport(
        options(
          () => current,
          copy,
          async () => {
            attempts++;
          },
        ),
      ),
      /unsaved changes/,
      kind,
    );
    assert.equal(attempts, 1, "Export does not retry a failed save in a loop.");
  }
});

test("typing while the save is pending cannot export an older snapshot", async () => {
  let current = copy(),
    receipt = copy();
  let complete!: () => void;
  const pending = prepareDocExport(
    options(
      () => current,
      () => receipt,
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    ),
  );
  current = { ...copy(), title: "Typed while waiting" };
  receipt = { ...copy(), version: 5 };
  complete();
  await assert.rejects(pending, /unsaved changes/);
});

test("readers and suggesting mode export the confirmed page, not an unapproved draft", async () => {
  const current = { ...copy(), title: "Unapproved suggestion" };
  assert.equal(
    await prepareDocExport({
      ...options(() => current, copy),
      editable: false,
    }),
    4,
  );
  await assert.rejects(
    prepareDocExport({
      ...options(() => ({ ...current, id: "closed-page" }), copy),
      editable: false,
    }),
    /unsaved changes/,
  );
});

test("closing or switching account cancels before or during save", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    prepareDocExport({
      ...options(copy, copy, async () => {
        calls++;
      }),
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
  const next = new AbortController();
  await assert.rejects(
    prepareDocExport({
      ...options(copy, copy, async () => {
        next.abort();
      }),
      signal: next.signal,
    }),
    { name: "AbortError" },
  );
});

test("invalid confirmed versions fail before any file request", async () => {
  for (const version of [
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    await assert.rejects(
      prepareDocExport(options(copy, () => ({ ...copy(), version }))),
      /unsaved changes/,
    );
});
