import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const require = createRequire(import.meta.url),
  mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
test("isolated PDF renderer gates messages, preserves page and zoom, and exposes readable page text", async () => {
  const { JSDOM } = mobileRequire("jsdom"),
    dom = new JSDOM(
      '<header><button data-action="previous"></button><span id="page"></span><button data-action="next"></button><button data-action="out"></button><button data-action="in"></button><button data-action="retry"></button></header><p id="status"></p><canvas></canvas><p id="text"></p>',
    );
  const doc = dom.window.document,
    handlers: Record<string, (event: any) => Promise<void>> = {};
  const widths: number[] = [],
    pages: number[] = [],
    requests: any[] = [];
  let destroyed = 0;
  doc.querySelector("canvas")!.getContext = (() => ({})) as any;
  const getDocument = (request: any) => {
    requests.push(request);
    return {
      destroy: async () => {
        destroyed++;
      },
      promise: Promise.resolve({
        numPages: 3,
        destroy: async () => {},
        getPage: async (page: number) => {
          pages.push(page);
          return {
            getViewport: ({ scale }: any) => ({
              width: 300 * scale,
              height: 200 * scale,
            }),
            render: ({ viewport }: any) => {
              widths.push(viewport.width);
              return { promise: Promise.resolve(), cancel: () => {} };
            },
            getTextContent: async () => ({
              items: [{ str: `Visible page ${page}` }],
            }),
          };
        },
      }),
    };
  };
  const source = readFileSync(
    new URL("../../scripts/pdf-preview-runtime.mjs", import.meta.url),
    "utf8",
  );
  const module = { exports: {} };
  const win: any = {
    devicePixelRatio: 1,
    parent: {},
    addEventListener: (name: string, fn: any) => {
      handlers[name] = fn;
    },
  };
  runInNewContext(transformSync(source, { format: "cjs" }).code, {
    module,
    exports: module.exports,
    require: (name: string) =>
      name.includes("pdf.worker")
        ? { WorkerMessageHandler: {} }
        : { getDocument },
    document: doc,
    window: win,
    ResizeObserver: class {
      observe() {}
    },
    setTimeout,
    clearTimeout,
    atob,
  });
  const send = (
    id: number,
    data = "JVBERi1zeW50aGV0aWM=",
    controls = "touch",
  ) =>
    handlers.message({
      source: win.parent,
      data: JSON.stringify({
        type: "orbyn-pdf",
        controls,
        id,
        data,
        palette: { text: "test-color" },
      }),
    });
  try {
    await handlers.message({
      source: {},
      data: { type: "orbyn-pdf", id: 0, data: "QQ==" },
    });
    assert.equal(requests.length, 0);
    await send(1);
    await settle();
    assert.equal(doc.querySelector("#text")!.textContent, "Visible page 1");
    assert.equal(requests[0].isEvalSupported, false);
    assert.equal(requests[0].useWasm, false);
    await send(1);
    assert.equal(
      requests.length,
      1,
      "duplicate delivery does not reload the PDF",
    );
    doc.querySelector<HTMLButtonElement>('[data-action="next"]')!.click();
    await settle();
    doc.querySelector<HTMLButtonElement>('[data-action="in"]')!.click();
    await settle();
    const zoomWidth = widths.at(-1)!;
    const previousRequests = requests.length;
    await send(1, "JVBERi1zeW50aGV0aWM=", "compact");
    assert.equal(
      doc.documentElement.style.getPropertyValue("--control-h"),
      "32px",
    );
    assert.equal(
      requests.length,
      previousRequests,
      "control sizing must not reload the PDF",
    );
    assert.equal(pages.at(-1), 2);
    assert.equal(widths.at(-1), zoomWidth);
    await send(1);
    assert.equal(
      doc.documentElement.style.getPropertyValue("--control-h"),
      "44px",
    );
    assert.equal(requests.length, previousRequests);

    await send(2, "JVBERi1uZXc=");
    await settle();
    assert.equal(pages.at(-1), 2);
    assert.equal(widths.at(-1), zoomWidth);
    assert.equal(doc.querySelector("#text")!.textContent, "Visible page 2");
    assert.ok(destroyed >= 1);
  } finally {
    dom.window.close();
  }
});
test("generated browser/native assets match and prevent external resources or host access", () => {
  const web = JSON.parse(
    readFileSync(
      new URL("../../desktop/assets/pdf-preview-runtime.json", import.meta.url),
      "utf8",
    ),
  );
  const mobile = JSON.parse(
    readFileSync(
      new URL("../../mobile/assets/pdf-preview-runtime.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(web.html, mobile.html);
  assert.equal(web.sourceDigest, mobile.sourceDigest);
  assert.match(web.html, /connect-src 'none'/);
  assert.match(web.html, /worker-src 'none'/);
  assert.match(web.html, /PDF.js/);
  for (const file of [
    "desktop/src/components/DocumentPdfPreview.tsx",
    "mobile/src/components/DocumentPdfPreview.web.tsx",
  ]) {
    const code = readFileSync(
      new URL(`../../${file}`, import.meta.url),
      "utf8",
    );
    assert.match(code, /sandbox="allow-scripts"/);
    assert.doesNotMatch(code, /allow-same-origin/);
  }
});

test("the bundled PDF.js version decodes and paints an actual PDF page with identifiable text", async () => {
  const rootRequire = createRequire(
    new URL("../../package.json", import.meta.url),
  );
  const { createCanvas } = rootRequire("@napi-rs/canvas");
  const { getDocument } =
    await import("../../node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const stream = "BT /F1 20 Tf 20 100 Td (Live Note preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const task = getDocument({
    data: new TextEncoder().encode(source),
    isEvalSupported: false,
    useSystemFonts: true,
    useWasm: false,
  });
  try {
    const pdf = await task.promise,
      page = await pdf.getPage(1);
    const content = await page.getTextContent();
    assert.match(
      content.items.map((item: any) => item.str ?? "").join(" "),
      /Live Note preview/,
    );
    const canvas = createCanvas(300, 200),
      context = canvas.getContext("2d");
    await page.render({
      canvasContext: context,
      viewport: page.getViewport({ scale: 1 }),
    }).promise;
    const pixels = context.getImageData(0, 0, 300, 200).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i] < 100 &&
        pixels[i + 1] < 100 &&
        pixels[i + 2] < 100 &&
        pixels[i + 3] > 0
      )
        ink++;
    assert.ok(
      ink > 100,
      `PDF must paint identifiable ink, not a blank page (${ink})`,
    );
  } finally {
    await task.destroy();
  }
});
