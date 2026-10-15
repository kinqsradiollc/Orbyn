import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  entryPoints: [`${root}scripts/pdf-preview-runtime.mjs`],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari17", "chrome120"],
  write: false,
  legalComments: "inline",
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const license = await readFile(
  `${root}node_modules/pdfjs-dist/LICENSE`,
  "utf8",
);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data: blob:; img-src data: blob:; connect-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;background:var(--surface,Canvas);color:var(--text,CanvasText);font:15px system-ui}header{font-size:var(--control-fs,13px);position:sticky;top:0;display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:4px 8px;background:var(--surface,Canvas);border-bottom:1px solid var(--border,ButtonBorder)}button{font:inherit;font-size:var(--control-fs,13px);line-height:20px;min-width:var(--control-h,44px);min-height:var(--control-h,44px);padding:4px 10px;border:1px solid var(--border,ButtonBorder);border-radius:var(--radius-sm,.5rem);background:var(--surface,ButtonFace);color:inherit}button:disabled{opacity:.5}button:focus-visible{outline:2px solid Highlight;outline-offset:2px}#page{margin-inline:8px}#status{padding:0 12px;color:var(--muted,GrayText)}main{overflow:auto;padding:12px}canvas{display:block;margin:auto}details{padding:12px}details p{white-space:pre-wrap;overflow-wrap:anywhere}[hidden]{display:none!important}</style></head><body><header aria-label="PDF controls"><button data-action="previous" aria-label="Previous page" disabled>‹</button><span id="page">PDF</span><button data-action="next" aria-label="Next page" disabled>›</button><button data-action="out" aria-label="Zoom out">−</button><button data-action="in" aria-label="Zoom in">+</button><button data-action="retry" hidden>Retry</button></header><p id="status" role="status">Preparing preview…</p><main><canvas role="img" aria-label="PDF page"></canvas></main><details><summary>Page text</summary><p id="text"></p></details><script>/*! PDF.js\n${license}\n*/\n${script}</script></body></html>`;
const sourceDigest = createHash("sha256")
  .update(await readFile(`${root}scripts/pdf-preview-runtime.mjs`))
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(`${root}package-lock.json`))
  .digest("hex");
for (const directory of ["desktop/assets", "mobile/assets"]) {
  await mkdir(`${root}${directory}`, { recursive: true });
  await writeFile(
    `${root}${directory}/pdf-preview-runtime.json`,
    JSON.stringify({ sourceDigest, html }) + "\n",
  );
}
