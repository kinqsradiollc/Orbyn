import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  prepareMermaidSource,
  mermaidThemeVariables,
  visibleDiagramTicks,
  diagramLabelTranslation,
  diagramDisplayScale,
  colors,
  darkColors,
  MERMAID_MAX_SOURCE,
} from "@orbyn/core";
import { mermaidFixtures } from "./helpers/mermaid-fixtures.js";

test("the bundled renderer matches the current security source", () => {
  const asset = JSON.parse(
    readFileSync(
      new URL("../../mobile/assets/mermaid-runtime.json", import.meta.url),
      "utf8",
    ),
  );
  const digest = createHash("sha256")
    .update(
      readFileSync(
        new URL("../../mobile/scripts/mermaid-runtime.mjs", import.meta.url),
      ),
    )
    .update(
      readFileSync(
        new URL("../../packages/core/src/mermaid.ts", import.meta.url),
      ),
    )
    .update(
      readFileSync(
        new URL("../../mobile/scripts/build-mermaid.mjs", import.meta.url),
      ),
    )
    .update(readFileSync(new URL("../../mobile/package.json", import.meta.url)))
    .update(readFileSync(new URL("../../package-lock.json", import.meta.url)))
    .digest("hex");
  assert.equal(
    asset.sourceDigest,
    digest,
    "run npm run build:diagrams -w mobile after renderer edits",
  );
  assert.match(asset.html, /connect-src 'none'/);
  assert.match(asset.html, /default-src 'none'/);
  assert.match(asset.html, /width:max-content;margin:0 auto/);
});

test("all ten diagram acceptance sources pass shared rendering bounds", () => {
  assert.equal(mermaidFixtures.length, 10);
  for (const fixture of mermaidFixtures)
    assert.equal(prepareMermaidSource(fixture.source), fixture.source);
});
test("diagram source normalizes line endings without discarding text", () => {
  assert.equal(
    prepareMermaidSource("\uFEFFflowchart TD\r\n A --> B"),
    "flowchart TD\n A --> B",
  );
});
test("empty and oversized diagram requests are rejected before rendering", () => {
  for (const source of [
    "",
    " ",
    "a".repeat(MERMAID_MAX_SOURCE + 1),
    "flowchart TD\n" + "\n".repeat(2048),
  ])
    assert.throws(() => prepareMermaidSource(source));
});
test("diagram configuration cannot override the application's renderer policy", () => {
  for (const source of [
    '%%{init:{"securityLevel":"loose"}}%%\nflowchart TD\n A --> B',
    "%% { config: {} } %%\nflowchart TD\n A --> B",
    "---\nconfig:\n securityLevel: loose\n---\nflowchart TD\n A --> B",
  ])
    assert.throws(() => prepareMermaidSource(source), /configuration/);
});

test("dense diagram ticks preserve readable endpoints and gain detail when zoomed", () => {
  const dense = Array.from({ length: 10 }, (_, i) => ({
    left: i * 10,
    right: i * 10 + 25,
  }));
  assert.deepEqual(visibleDiagramTicks(dense), [0, 4, 9]);
  assert.equal(
    visibleDiagramTicks(
      dense.map((b) => ({ left: b.left * 4, right: b.left * 4 + 25 })),
    ).length,
    10,
  );
  assert.deepEqual(
    visibleDiagramTicks([
      { left: 0, right: 40 },
      { left: 10, right: 50 },
    ]),
    [0],
  );
  assert.deepEqual(visibleDiagramTicks([{ left: NaN, right: 50 }]), []);
});

test("both themes use application series colors and legible mindmap labels", () => {
  for (const theme of [colors, darkColors]) {
    const vars = mermaidThemeVariables({
      background: theme.surface,
      primaryColor: theme.surface,
      primaryBorderColor: theme.accent,
      primaryTextColor: theme.text,
      secondaryColor: theme.soft,
      tertiaryColor: theme.surfaceMuted,
      lineColor: theme.muted,
      textColor: theme.text,
      noteBkgColor: theme.highBg,
      noteTextColor: theme.text,
      highText: theme.highText,
      mediumText: theme.mediumText,
      lowText: theme.lowText,
    });
    assert.equal(vars.pie1, theme.accent);
    assert.equal(vars.pie2, theme.muted);
    assert.equal(vars.pie3, theme.highText);
    assert.equal(vars.cScaleInv0, theme.accent);
    assert.equal(vars.cScaleLabel0, theme.text);
  }
});

test("tick measurement accepts non-enumerable DOMRect coordinates", () => {
  const box = Object.defineProperties(
    {},
    { left: { get: () => 10 }, right: { get: () => 40 } },
  ) as { left: number; right: number };
  assert.deepEqual(visibleDiagramTicks([box]), [0]);
});

test("mindmap circular labels center their actual local bounds", () => {
  assert.equal(
    diagramLabelTranslation(
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 0, y: 0 },
    ),
    "translate(-50, -10)",
  );
  assert.equal(
    diagramLabelTranslation(
      { x: -5, y: -12, width: 100, height: 20 },
      { x: 10, y: 20 },
    ),
    "translate(-35, 22)",
  );
  assert.equal(
    diagramLabelTranslation(
      { x: 0, y: 0, width: NaN, height: 20 },
      { x: 0, y: 0 },
    ),
    null,
  );
});

test("actual size keeps wide diagrams readable while fit restores containment", () => {
  assert.equal(diagramDisplayScale(2000, 320, 1), 296 / 2000);
  assert.equal(diagramDisplayScale(2000, 320, 1, true), 1);
  assert.equal(diagramDisplayScale(2000, 320, 2, true), 2);
  assert.equal(diagramDisplayScale(2000, 320, 20, true), 3);
  assert.equal(diagramDisplayScale(NaN, NaN, NaN), 1);
});
