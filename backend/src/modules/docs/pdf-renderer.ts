import { readFile } from "node:fs/promises";
import { createDiagramExportBridge, renderHtmlDiagrams } from "@orbyn/core";
import {
  openPdfBrowser,
  type PdfBrowser,
  type PdfBrowserEvent,
} from "./pdf-browser.js";

const MAX_HTML_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 24 * 1024 * 1024;
const PRINT_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const PRINT_STYLE = `@page { size: A4; margin: 16mm; }
body { max-width: none; margin: 0; padding: 0; font-size: 11pt; overflow-wrap: anywhere; }
h1,h2,h3,h4,h5,h6 { break-after: avoid; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; overflow: visible; }
table { width: 100%; table-layout: fixed; } td,th { overflow-wrap: anywhere; }
figure { break-inside: avoid; margin: 16px 0; } figure img { max-width: 100%; max-height: 220mm; object-fit: contain; }
.export-diagram img + details { display: none; } math { max-width: 100%; }
`;

/** Add print-only bounds and deny resource loads before any document content is parsed. */
function snapshotHtml(html: string, print: boolean): string {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES)
    throw new Error("This document is too large to print.");
  const start = /<html\b[^>]*>/i.exec(html);
  if (!start) throw new Error("The document print snapshot is invalid.");
  const at = start.index + start[0].length;
  return (
    html.slice(0, at) +
    `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}"><style>${print ? PRINT_STYLE : `figure img { max-width: 100%; height: auto; } @media print { ${PRINT_STYLE} }`}</style>` +
    html.slice(at)
  );
}

/** Bound the PDF print layout and deny resource loads before parsing content. */
export const pdfPrintHtml = (html: string): string => snapshotHtml(html, true);
/** Portable script-free HTML preserves its screen layout and adds bounded print styles. */
export const portableSnapshotHtml = (html: string): string =>
  snapshotHtml(html, false);

export type DocumentRendererOptions = {
  html: string;
  executable: string;
  signal?: AbortSignal;
  open?: (executable: string, signal: AbortSignal) => Promise<PdfBrowser>;
  runtime?: () => Promise<string>;
};

/** Print only a server-authorized snapshot with current permission/revision fences. */
export async function renderPdfSnapshot(
  options: DocumentRendererOptions,
): Promise<Buffer> {
  const result = await renderDocumentSnapshot(options, "pdf");
  if (!Buffer.isBuffer(result)) throw new Error("Invalid document PDF result.");
  return result;
}

/** Return inert rendered HTML; the caller must recheck current authority before delivery. */
export async function renderHtmlSnapshot(
  options: DocumentRendererOptions,
): Promise<string> {
  const result = await renderDocumentSnapshot(options, "html");
  if (typeof result !== "string")
    throw new Error("Invalid document HTML result.");
  return result;
}

const active = (signal: AbortSignal) => {
  if (signal.aborted)
    throw Object.assign(new Error("PDF export cancelled."), {
      name: "AbortError",
    });
};

async function page(browser: PdfBrowser): Promise<string> {
  const { targetId } = await browser.command<{ targetId: string }>(
    "Target.createTarget",
    { url: "about:blank" },
  );
  const { sessionId } = await browser.command<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId, flatten: true },
  );
  await browser.command("Page.enable", {}, sessionId);
  await browser.command("Runtime.enable", {}, sessionId);
  await browser.command(
    "Fetch.enable",
    { patterns: [{ urlPattern: "*" }] },
    sessionId,
  );
  return sessionId;
}

async function document(
  browser: PdfBrowser,
  sessionId: string,
  html: string,
): Promise<void> {
  const { frameTree } = await browser.command<{
    frameTree: { frame: { id: string } };
  }>("Page.getFrameTree", {}, sessionId);
  await browser.command(
    "Page.setDocumentContent",
    { frameId: frameTree.frame.id, html },
    sessionId,
  );
}

/** Print only a server-authorized HTML snapshot; callers must enforce document permissions/revision first. */
async function renderDocumentSnapshot(
  {
    html,
    executable,
    signal = new AbortController().signal,
    open = openPdfBrowser,
    runtime = () =>
      readFile(
        new URL("../../../assets/mermaid-runtime.json", import.meta.url),
        "utf8",
      ).then((value) => JSON.parse(value).html as string),
  }: DocumentRendererOptions,
  format: "pdf" | "html",
): Promise<Buffer | string> {
  active(signal);
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES)
    throw new Error("This document is too large to print.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, 30_000);
  let browser: PdfBrowser | undefined;
  let bridge: ReturnType<typeof createDiagramExportBridge> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    browser = await open(executable, controller.signal);
    active(signal);
    active(controller.signal);
    let engine: string | undefined;
    unsubscribe = browser.events((event: PdfBrowserEvent) => {
      if (
        event.method === "Fetch.requestPaused" &&
        typeof event.params.requestId === "string"
      ) {
        void browser!
          .command(
            "Fetch.failRequest",
            {
              requestId: event.params.requestId,
              errorReason: "BlockedByClient",
            },
            event.sessionId,
          )
          .catch(abort);
      }
      if (
        event.sessionId === engine &&
        event.method === "Runtime.bindingCalled" &&
        event.params.name === "orbynPdfResult" &&
        typeof event.params.payload === "string"
      )
        bridge?.receive(event.params.payload);
    });
    if (html.includes('data-orbyn-diagram="mermaid"')) {
      engine = await page(browser);
      await browser.command(
        "Runtime.addBinding",
        { name: "orbynPdfResult" },
        engine,
      );
      await document(browser, engine, await runtime());
      await browser.command(
        "Runtime.evaluate",
        {
          expression:
            "window.ReactNativeWebView = { postMessage: (data) => window.orbynPdfResult(data) }",
        },
        engine,
      );
      bridge = createDiagramExportBridge((request) => {
        if (request)
          void browser!
            .command(
              "Runtime.evaluate",
              {
                expression: `window.postMessage(${JSON.stringify(request)}, '*')`,
              },
              engine,
            )
            .catch(() => {
              bridge?.dispose();
              abort();
            });
      }, 10_000);
      html = await renderHtmlDiagrams(html, bridge.render, controller.signal);
      bridge.dispose();
      bridge = undefined;
    }
    active(signal);
    active(controller.signal);
    const output = await page(browser);
    const snapshot =
      format === "pdf"
        ? pdfPrintHtml(
            html.replace(
              /<details><summary>Diagram source<\/summary>/g,
              "<details open><summary>Diagram source</summary>",
            ),
          )
        : portableSnapshotHtml(html);
    if (Buffer.byteLength(snapshot, "utf8") > MAX_HTML_BYTES)
      throw new Error("The rendered document is too large.");
    await document(browser, output, snapshot);
    const ready = await browser.command<{
      result?: { value?: boolean };
      exceptionDetails?: unknown;
    }>(
      "Runtime.evaluate",
      {
        expression: `Promise.all(Array.from(document.images, image => image.complete ? Promise.resolve(image.naturalWidth > 0) : new Promise(resolve => { image.onload = () => resolve(true); image.onerror = () => resolve(false); }))).then(values => document.fonts.ready.then(() => values.every(Boolean)))`,
        awaitPromise: true,
        returnByValue: true,
      },
      output,
    );
    if (ready.exceptionDetails || ready.result?.value !== true)
      throw new Error("A document image could not be printed.");
    active(signal);
    active(controller.signal);
    if (format === "html") return snapshot;
    const result = await browser.command<{ data: string }>(
      "Page.printToPDF",
      {
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        generateTaggedPDF: true,
        transferMode: "ReturnAsBase64",
      },
      output,
    );
    active(signal);
    active(controller.signal);
    if (
      typeof result.data !== "string" ||
      result.data.length > Math.ceil((MAX_PDF_BYTES * 4) / 3)
    )
      throw new Error("The rendered PDF is too large.");
    const pdf = Buffer.from(result.data, "base64");
    if (pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("The PDF renderer returned an invalid document.");
    return pdf;
  } catch (error) {
    active(signal);
    if (timedOut) throw new Error("Document PDF rendering timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    bridge?.dispose();
    unsubscribe?.();
    await browser?.close();
  }
}
