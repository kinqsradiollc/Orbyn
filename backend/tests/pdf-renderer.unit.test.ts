import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pdfPrintHtml,
  renderPdfSnapshot,
  renderHtmlSnapshot,
  portableSnapshotHtml,
} from "../src/modules/docs/pdf-renderer.js";
import type {
  PdfBrowser,
  PdfBrowserEvent,
} from "../src/modules/docs/pdf-browser.js";

const html = "<!doctype html><html><h1>Fixture</h1><p>Content</p></html>";
function fixture({
  imageReady = true,
  result = Buffer.from("%PDF-1.7\nfixture").toString("base64"),
  renderError = false,
  onReady = () => {},
} = {}) {
  const calls: {
    method: string;
    params: Record<string, unknown>;
    sessionId?: string;
  }[] = [];
  let listener: ((event: PdfBrowserEvent) => void) | undefined;
  let pages = 0,
    closes = 0;
  const browser: PdfBrowser = {
    async command<T>(
      method: string,
      params = {},
      sessionId?: string,
    ): Promise<T> {
      calls.push({ method, params, sessionId });
      if (method === "Target.createTarget")
        return { targetId: `page-${++pages}` } as T;
      if (method === "Target.attachToTarget")
        return { sessionId: params.targetId } as T;
      if (method === "Page.getFrameTree")
        return { frameTree: { frame: { id: "frame" } } } as T;
      if (
        method === "Runtime.evaluate" &&
        String(params.expression).startsWith("window.postMessage(")
      ) {
        const expression = String(params.expression);
        const request = JSON.parse(
          JSON.parse(
            expression.slice(
              "window.postMessage(".length,
              expression.lastIndexOf(", '*')"),
            ),
          ),
        );
        const value = {
          type: "orbyn-diagram-result",
          id: request.id,
          ...(renderError
            ? { error: "Secret diagram source" }
            : {
                svg: '<svg viewBox="0 0 100 100"><text>Strict diagram</text></svg>',
              }),
        };
        listener?.({
          method: "Runtime.bindingCalled",
          sessionId: "unrelated-page",
          params: {
            name: "orbynPdfResult",
            payload: JSON.stringify({ ...value, svg: "<svg>Spoof</svg>" }),
          },
        });
        listener?.({
          method: "Runtime.bindingCalled",
          sessionId,
          params: { name: "orbynPdfResult", payload: JSON.stringify(value) },
        });
      }
      if (
        method === "Runtime.evaluate" &&
        String(params.expression).startsWith("Promise.all")
      ) {
        onReady();
        return { result: { value: imageReady } } as T;
      }
      if (method === "Page.printToPDF") return { data: result } as T;
      return {} as T;
    },
    events(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    async close() {
      closes++;
    },
  };
  return {
    calls,
    closes: () => closes,
    listening: () => !!listener,
    emit: (event: PdfBrowserEvent) => listener?.(event),
    options: {
      html,
      executable: "/fixture/chromium",
      open: async () => browser,
      runtime: async () => "Trusted isolated engine",
    },
  };
}

test("PDF print document installs resource denial before content and contains print layout bounds", () => {
  const result = pdfPrintHtml(html);
  assert.ok(result.indexOf("Content-Security-Policy") < result.indexOf("<h1>"));
  assert.match(result, /script-src 'none'/);
  assert.match(result, /connect-src 'none'/);
  assert.match(result, /img-src data:/);
  assert.match(result, /size: A4/);
  assert.match(result, /white-space: pre-wrap/);
  assert.match(result, /table-layout: fixed/);
  assert.throws(() => pdfPrintHtml("No document root"), /invalid/);
});

test("PDF printing uses a fresh blank target, waits for images/fonts and always closes the owned browser", async () => {
  const view = fixture();
  const pdf = await renderPdfSnapshot(view.options);
  assert.match(pdf.toString(), /^%PDF-/);
  assert.deepEqual(
    view.calls.find((call) => call.method === "Target.createTarget")!.params,
    { url: "about:blank" },
  );
  assert.ok(view.calls.some((call) => call.method === "Fetch.enable"));
  const print = view.calls.find((call) => call.method === "Page.printToPDF")!;
  assert.equal(print.params.generateTaggedPDF, true);
  assert.equal(print.params.preferCSSPageSize, true);
  assert.ok(
    view.calls.findIndex((call) => call.method === "Runtime.evaluate") <
      view.calls.indexOf(print),
  );
  assert.equal(view.closes(), 1);
  assert.equal(view.listening(), false);
});

test("PDF renders marked diagrams in the isolated engine and ignores unrelated session results", async () => {
  const view = fixture();
  await renderPdfSnapshot({
    ...view.options,
    html: '<html><pre class="diagram-source" data-orbyn-diagram="mermaid"><code>flowchart LR\nA --&gt; B</code></pre></html>',
  });
  const documents = view.calls.filter(
    (call) => call.method === "Page.setDocumentContent",
  );
  assert.equal(documents.length, 2);
  assert.equal(documents[0].params.html, "Trusted isolated engine");
  const printed = String(documents[1].params.html);
  assert.match(printed, /data:image\/svg\+xml/);
  const image = /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(
    printed,
  );
  assert.ok(image);
  assert.match(decodeURIComponent(image[1]), /Strict diagram/);
  assert.doesNotMatch(printed, /Spoof/);
  assert.equal(view.closes(), 1);
});

test("failed PDF diagrams keep readable source and a generic caption", async () => {
  const view = fixture({ renderError: true });
  await renderPdfSnapshot({
    ...view.options,
    html: '<html><pre class="diagram-source" data-orbyn-diagram="mermaid"><code>flowchart LR\nA --&gt; B</code></pre></html>',
  });
  const printed = String(
    view.calls.filter((call) => call.method === "Page.setDocumentContent")[1]
      .params.html,
  );
  assert.match(printed, /rendering unavailable; source retained/);
  assert.match(printed, /<details open>/);
  assert.match(printed, /flowchart LR/);
  assert.doesNotMatch(printed, /Secret diagram source/);
});

test("PDF resource requests are denied by their original session", async () => {
  const view = fixture({
    onReady: () =>
      view.emit({
        method: "Fetch.requestPaused",
        sessionId: "page-1",
        params: { requestId: "remote-request" },
      }),
  });
  await renderPdfSnapshot(view.options);
  assert.deepEqual(
    view.calls.find((call) => call.method === "Fetch.failRequest"),
    {
      method: "Fetch.failRequest",
      params: { requestId: "remote-request", errorReason: "BlockedByClient" },
      sessionId: "page-1",
    },
  );
});

test("cancelled PDF work never prints and closes its browser", async () => {
  const controller = new AbortController();
  const view = fixture({ onReady: () => controller.abort() });
  await assert.rejects(
    renderPdfSnapshot({ ...view.options, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(
    view.calls.some((call) => call.method === "Page.printToPDF"),
    false,
  );
  assert.equal(view.closes(), 1);
});

test("missing images and malformed PDF output fail without handing off a document", async () => {
  for (const view of [
    fixture({ imageReady: false }),
    fixture({ result: Buffer.from("Not a PDF").toString("base64") }),
  ]) {
    await assert.rejects(renderPdfSnapshot(view.options));
    assert.equal(view.closes(), 1);
  }
});

test("oversized HTML is refused before starting a browser", async () => {
  let starts = 0;
  await assert.rejects(
    renderPdfSnapshot({
      html: "x".repeat(20 * 1024 * 1024 + 1),
      executable: "/unused",
      open: async () => {
        starts++;
        throw new Error("Must not start");
      },
    }),
    /too large/,
  );
  assert.equal(starts, 0);
});

test("portable HTML keeps screen styles and contains script-free print bounds", () => {
  const result = portableSnapshotHtml(html);
  assert.ok(result.indexOf("Content-Security-Policy") < result.indexOf("<h1>"));
  assert.match(result, /script-src 'none'/);
  assert.match(result, /connect-src 'none'/);
  assert.match(result, /@media print/);
  assert.match(result, /name="viewport" content="width=device-width/);
  assert.match(result, /@media screen and \(max-width: 640px\)/);
  assert.doesNotMatch(result, /<script|<iframe/i);
});

test("HTML output renders inert diagrams, retains source and never calls PDF printing", async () => {
  const view = fixture();
  const result = await renderHtmlSnapshot({
    ...view.options,
    html: '<!doctype html><html><pre class="diagram-source" data-orbyn-diagram="mermaid"><code>graph TD; A--&gt;B</code></pre></html>',
  });
  assert.match(result, /data:image\/svg\+xml/);
  assert.match(result, /<details><summary>Diagram source/);
  assert.doesNotMatch(result, /Spoof|<script/i);
  assert.equal(
    view.calls.some((call) => call.method === "Page.printToPDF"),
    false,
  );
  assert.equal(view.closes(), 1);
  assert.equal(view.listening(), false);
});

test("HTML renderer retains useful fallback source without engine error details", async () => {
  const view = fixture({ renderError: true });
  const result = await renderHtmlSnapshot({
    ...view.options,
    html: '<!doctype html><html><pre class="diagram-source" data-orbyn-diagram="mermaid"><code>graph TD; A</code></pre></html>',
  });
  assert.match(result, /Diagram rendering unavailable; source retained/);
  assert.match(result, /graph TD; A/);
  assert.doesNotMatch(result, /Secret diagram source/);
  assert.equal(view.closes(), 1);
});

test("cancelled HTML and missing picture bytes do not hand off a document", async () => {
  const controller = new AbortController();
  const view = fixture({ onReady: () => controller.abort() });
  await assert.rejects(
    renderHtmlSnapshot({ ...view.options, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(view.closes(), 1);
  const missing = fixture({ imageReady: false });
  await assert.rejects(renderHtmlSnapshot(missing.options));
  assert.equal(missing.closes(), 1);
});
