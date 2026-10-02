import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  prepareDocExport,
  renderHtmlDiagrams,
  type DocExportSnapshot,
  type DocBlock,
} from "@orbyn/core";

/** Run the real persistence, flush and export callbacks; integrations are isolated. */
function fixture(
  native: boolean,
  mode: "success" | "failed" | "offline" | "pending" = "success",
  editable = true,
) {
  const text = readFileSync(
    new URL(
      native
        ? "../../mobile/src/screens/docs/DocEditor.tsx"
        : "../../desktop/src/features/docs/DocEditor.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const file = ts.createSourceFile(
    "DocEditor.tsx",
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [
    "persist",
    "flush",
    "prepareFileExport",
    native ? "exportFile" : "shareFile",
    ...(!native ? ["download"] : []),
  ];
  const code: string[] = [];
  function find(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text)
    )
      code.push(
        `const ${node.name.text} = ${node.initializer!.getText(file)}; exports.${node.name.text} = ${node.name.text};`,
      );
    ts.forEachChild(node, find);
  }
  find(file);
  assert.equal(code.length, names.length);
  const doc: DocExportSnapshot = {
    id: "page",
    title: "Page",
    version: 4,
    content: [{ type: "paragraph", text: "Saved", id: "line" }],
  };
  const live = {
    current: {
      title: "Updated title",
      blocks: [
        { type: "paragraph", text: "Updated body", id: "line" },
      ] as DocBlock[],
    },
  };
  const exportSaved = { current: structuredClone(doc) };
  const dirty = { current: true };
  const writes: unknown[] = [],
    files: { version?: number }[] = [],
    offline: unknown[] = [];
  const controller = new AbortController();
  const reports: unknown[] = [];
  const clicks: string[] = [];
  let complete: (() => void) | undefined;
  const context: Record<string, any> = {
    exports: {},
    doc,
    live,
    dirty,
    exportSaved,
    exportDocId: { current: doc.id },
    exportCurrent: {
      current: () => ({
        id: doc.id,
        title: live.current.title,
        content: structuredClone(live.current.blocks),
      }),
    },
    base: { current: doc.content },
    baseTitle: { current: doc.title },
    version: { current: doc.version },
    ticksFrom: { current: doc.version },
    timer: { current: null },
    saveQueue: { current: Promise.resolve() },
    canWrite: editable,
    suggesting: !editable,
    prepareDocExport,
    renderHtmlDiagrams,
    Blob,
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
    document: {
      createElement: () => ({
        click() {
          clicks.push("download");
        },
        href: "",
        download: "",
      }),
    },
    setDownloadMenu() {},
    toast() {},
    EXPORT_LABELS: {
      md: { name: "Markdown" },
      html: { name: "HTML" },
      txt: { name: "Text" },
      pdf: { name: "PDF" },
      docx: { name: "Word" },
    },
    useCallback: (callback: unknown) => callback,
    setSave() {},
    setSaving() {},
    setSavedAt() {},
    setNow() {},
    setKeptOffline() {},
    onChanged() {},
    report(error: unknown) {
      reports.push(error);
    },
    settle() {},
    reconcile() {},
    rememberPage: async () => {},
    savePageOffline: async (value: unknown) => {
      offline.push(value);
    },
    isOfflineError: () => mode === "offline",
    clearTimeout,
    Date,
    Error,
    pageWithDraft: () => structuredClone(live.current.blocks),
    unsaved: () => dirty.current,
    diagramExport: {
      signal: () => controller.signal,
      render: async () => "<svg/>",
    },
    sharePageFile: async (
      _id: string,
      _format: string,
      _title: string,
      options: { version?: number },
    ) => {
      files.push(options);
    },
    downloadDoc: async (
      _id: string,
      _format: string,
      options: { version?: number },
    ) => {
      files.push(options);
    },
    client: {
      async exportDoc(
        _id: string,
        _format: string,
        options: { version?: number },
      ) {
        files.push(options);
        return {
          blob: new Blob(["Saved page"], { type: "text/plain" }),
          name: "Page.md",
        };
      },
      async updateDoc(
        _id: string,
        input: { title: string; content: DocBlock[] },
      ) {
        writes.push(input);
        if (mode === "failed" || mode === "offline")
          throw new Error("Synthetic save failure");
        if (mode === "pending")
          await new Promise<void>((resolve) => {
            complete = resolve;
          });
        return {
          ...doc,
          ...structuredClone(input),
          version: 5,
          updated_at: new Date().toISOString(),
        };
      },
    },
  };
  runInNewContext(
    ts.transpileModule(code.join("\n"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    context,
  );
  return {
    context,
    live,
    exportSaved,
    writes,
    files,
    offline,
    controller,
    reports,
    clicks,
    complete: () => complete!(),
    downloadFile: (format = "md") =>
      context.exports[native ? "exportFile" : "download"](
        format,
      ) as Promise<void>,
    exportFile: (format = "md") =>
      context.exports[native ? "exportFile" : "shareFile"](
        format,
      ) as Promise<void>,
  };
}

for (const native of [false, true]) {
  const platform = native ? "native" : "web";
  test(`${platform} actual editor flushes before file sharing and sends the confirmed version`, async () => {
    const f = fixture(native);
    await f.exportFile();
    assert.equal(f.writes.length, 1);
    assert.equal(f.files[0].version, 5);
    if (native)
      assert.equal(
        f.context.dirty.current,
        true,
        "A cloned draft's reference inequality cannot prevent a confirmed export.",
      );
  });
  test(`${platform} actual editor refuses a caught save failure even with a speculative merge baseline`, async () => {
    const f = fixture(native, "failed");
    f.context.base.current = f.live.current.blocks;
    await assert.rejects(f.exportFile(), /unsaved changes/);
    assert.equal(f.files.length, 0);
    assert.equal(f.writes.length, 1);
  });
  test(`${platform} actual editor rejects newer typing while save is pending`, async () => {
    const f = fixture(native, "pending");
    const pending = f.exportFile();
    const rejected = assert.rejects(pending, /unsaved changes/);
    await Promise.resolve();
    await Promise.resolve();
    f.live.current = { ...f.live.current, title: "Newer typing" };
    f.complete();
    await rejected;
    assert.equal(f.files.length, 0);
  });
  test(`${platform} actual editor cancels a file action when its owning scope closes`, async () => {
    const f = fixture(native, "pending");
    const pending = f.exportFile();
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    f.controller.abort();
    f.complete();
    await rejected;
    assert.equal(f.files.length, 0);
  });
  test(`${platform} suggestions export the confirmed page without saving unapproved draft text`, async () => {
    const f = fixture(native, "success", false);
    await f.exportFile("pdf");
    assert.equal(f.writes.length, 0);
    assert.equal(f.files[0].version, 4);
  });
}
test("native offline draft remains local and cannot export the older saved copy", async () => {
  const f = fixture(true, "offline");
  await assert.rejects(f.exportFile(), /unsaved changes/);
  assert.equal(f.offline.length, 1);
  assert.equal(f.files.length, 0);
});

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} every file format uses the saved revision guard`, async () => {
    for (const format of ["md", "html", "txt", "pdf", "docx"]) {
      const f = fixture(native);
      await f.downloadFile(format);
      assert.equal(f.files[0].version, 5, format);
      assert.equal(f.writes.length, 1, format);
      assert.equal(f.reports.length, 0, format);
      if (!native) assert.equal(f.clicks.length, 1, format);
    }
  });
  test(`${native ? "native" : "web"} a late save from a closed document cannot replace another document's export receipt`, async () => {
    const f = fixture(native, "pending");
    const pending = f.exportFile();
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    f.context.exportDocId.current = "new-document";
    f.controller.abort();
    f.complete();
    await rejected;
    assert.equal(f.exportSaved.current.version, 4);
    assert.equal(f.files.length, 0);
  });
}

test("web download reports an unsaved revision without requesting or clicking a file", async () => {
  const f = fixture(false, "failed");
  await f.downloadFile("html");
  assert.equal(f.files.length, 0);
  assert.equal(f.clicks.length, 0);
  assert.ok(
    f.reports.some((error) => String(error).includes("unsaved changes")),
  );
});
