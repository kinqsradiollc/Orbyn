import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  docToHtml,
  mermaidDiagramCss,
  DIAGRAM_EXPORT_PALETTE,
  visibleDiagramTicks,
} from "@orbyn/core";
import {
  renderHtmlSnapshot,
  renderPdfSnapshot,
} from "../src/modules/docs/pdf-renderer.js";
import { readPdf } from "../src/modules/imports/pdf.js";
import { mermaidFixtures } from "./helpers/mermaid-fixtures.js";

const executable =
  process.env.PDF_TEST_CHROME ??
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
if (!executable)
  throw new Error(
    "A sandboxed Chromium executable is required for diagram readability checks.",
  );
const gantt = mermaidFixtures.find((fixture) => fixture.kind === "gantt")!;
const html = docToHtml(
  "Schedule",
  [{ type: "code", lang: "mermaid", text: gantt.source }],
  { diagramSources: true },
);

test("axis text uses readable fixed sizing while retaining the Orbyn palette", () => {
  const css = mermaidDiagramCss(DIAGRAM_EXPORT_PALETTE);
  assert.match(css, /\.tick text \{ font-size: 16px !important; \}/);
  assert.match(css, new RegExp(DIAGRAM_EXPORT_PALETTE.primaryBorderColor));
  assert.throws(() =>
    mermaidDiagramCss({
      ...DIAGRAM_EXPORT_PALETTE,
      primaryColor: "url(https://external.invalid)",
    }),
  );
});

test("actual Gantt export retains its dates and source with larger text and bounded bars", async () => {
  const rendered = await renderHtmlSnapshot({ html, executable });
  assert.doesNotMatch(rendered, /Diagram rendering unavailable/);
  const data = /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(
    rendered,
  )?.[1];
  assert.ok(data);
  const svg = decodeURIComponent(data);
  assert.match(svg, /font-size:\s*16px/);
  assert.match(svg, /2026-10-/);
  assert.match(svg, /Review/);
  assert.match(svg, /Release/);
  assert.match(rendered, /Diagram source/);
  assert.doesNotMatch(
    svg,
    /<script|<foreignObject|<image|(?:href|src)="https?:/,
  );
});

test("printed Gantt dates stay at readable size and within the paper", async () => {
  const pdf = await renderPdfSnapshot({ html, executable });
  const pages = await readPdf(pdf, 10);
  const dates = pages.flatMap((page) =>
    page.text.spans
      .filter((span) => /^2026-10-\d\d$/.test(span.text))
      .map((span) => ({ span, page: page.text })),
  );
  assert.ok(
    dates.length >= 2,
    "at least two non-overlapping dates must remain visible",
  );
  assert.equal(
    new Set(dates.map(({ span }) => span.text)).size,
    dates.length,
    "formatted date labels must not repeat",
  );
  for (const { span, page } of dates) {
    assert.ok(span.size >= 9, `date text is too small: ${span.size}`);
    assert.ok(
      span.x >= 0 && span.x + span.w <= page.width + 1,
      "date label must fit the page",
    );
  }
  for (const { span } of dates) {
    const sameLine = dates.filter(
      (other) => other.span !== span && Math.abs(other.span.y - span.y) < 1,
    );
    for (const other of sameLine)
      assert.ok(
        span.x + span.w <= other.span.x ||
          other.span.x + other.span.w <= span.x,
        "date labels must not overlap",
      );
  }
});

test("date ticks suppress repeated formatted values without changing the chronological grid", () => {
  assert.deepEqual(
    visibleDiagramTicks([
      { left: 0, right: 40, text: "2026-10-01" },
      { left: 50, right: 90, text: "2026-10-01" },
      { left: 100, right: 140, text: "2026-10-02" },
      { left: 150, right: 190, text: "2026-10-03" },
    ]),
    [0, 2, 3],
  );
  assert.deepEqual(
    visibleDiagramTicks([
      { left: 0, right: 40, text: "Day" },
      { left: 50, right: 90, text: "Day" },
    ]),
    [0],
  );
  assert.deepEqual(
    visibleDiagramTicks([
      { left: 0, right: 40 },
      { left: 50, right: 90 },
    ]),
    [0, 1],
  );
});
