import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeDocumentDownload as web } from "../../desktop/src/features/documents/editor/document-download.js";
import { routeDocumentDownload as expo } from "../../mobile/src/features/documents/editor/document-download.js";
for (const [platform, route] of [
  ["web", web],
  ["Expo", expo],
] as const) {
  test(`${platform} page Download routes canonical formats and exactly the explicitly selected embedded PDF`, async () => {
    const calls: string[] = [];
    let source = "First";
    const handle = {
      current: async () => {
        calls.push(source);
      },
    };
    const canonical = async () => {
      calls.push("canonical");
    };
    await route("pdf", false, handle, () => true, canonical);
    await route("md", true, handle, () => true, canonical);
    await route("pdf", true, handle, () => true, canonical);
    source = "Second";
    handle.current = async () => {
      calls.push(source);
    };
    await route("pdf", true, handle, () => true, canonical);
    assert.deepEqual(calls, ["canonical", "canonical", "First", "Second"]);
  });
  test(`${platform} invalid/save/account readiness and unavailable/inflight sources never fall back to another document`, async () => {
    let compiled = 0,
      canonical = 0;
    const other = async () => {
      canonical++;
    };
    const handle: { current: (() => Promise<void>) | null } = {
      current: async () => {
        compiled++;
      },
    };
    for (const format of ["md", "pdf"])
      await assert.rejects(
        route(format, true, handle, () => false, other),
        /Save or restore/,
      );
    handle.current = null;
    await assert.rejects(
      route("pdf", true, handle, () => true, other),
      /unavailable/,
    );
    handle.current = async () => {
      throw new Error("Export already in progress");
    };
    await assert.rejects(
      route("pdf", true, handle, () => true, other),
      /in progress/,
    );
    assert.equal(compiled, 0);
    assert.equal(canonical, 0);
  });
}
test("all four document Download owners connect the guarded source handle and retain the authoritative version", () => {
  for (const file of [
    "desktop/src/features/documents/editor/LegacyDocEditor.tsx",
    "desktop/src/features/documents/editor/StructuredDocEditor.tsx",
    "mobile/src/features/documents/editor/LegacyDocEditor.tsx",
    "mobile/src/features/documents/editor/StructuredDocEditor.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../../${file}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /routeDocumentDownload\(/);
    assert.match(source, /exportPdfHandle=\{sourcePdfExport\}/);
    assert.match(source, /latexSourceNumber >= 0/);
    assert.match(source, /sourceLeaveCheck.current\?\.\(\) === true/);
    assert.match(source, /downloadPending.current/);
    assert.match(
      source,
      /version: (?:version.current|store.state.session!\.saved.version)/,
    );
  }
});
