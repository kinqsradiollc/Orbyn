import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  entryPoints: [`${root}scripts/latex-html-runtime.mjs`],
  bundle: true,
  minify: true,
  platform: "browser",
  loader: { ".keep": "empty" },
  format: "iife",
  legalComments: "inline",
  write: false,
  target: ["safari17", "chrome120"],
});
const fonts = await build({
  entryPoints: [`${root}node_modules/latex.js/dist/css/katex.css`],
  bundle: true,
  minify: true,
  write: false,
  loader: { ".woff2": "dataurl" },
});
const base = (
  await readFile(`${root}node_modules/latex.js/dist/css/base.css`, "utf8")
).replace(/@import[^;]+;/g, "");
const article = (
  await readFile(`${root}node_modules/latex.js/dist/css/article.css`, "utf8")
).replace(/@import[^;]+;/g, "");
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const license = await readFile(`${root}node_modules/latex.js/LICENSE`, "utf8");
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${fonts.outputFiles[0].text}\n${base}\n${article}\n:root{--size:calc(16px * var(--preview-font-scale,1));font-size:calc(16px * var(--preview-font-scale,1));--line-height:1.65;color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;background:var(--surface,Canvas);color:var(--text,CanvasText);font:1rem/1.65 system-ui}body{padding:24px}main,.body{max-width:none!important;width:auto!important;margin:0!important;padding:0!important;font-family:inherit!important}#status{font:13px/1.5 system-ui;color:var(--muted,GrayText);margin:0 0 12px}#status:empty{display:none}[hidden]{display:none!important}#diagnostics{font:13px/1.5 system-ui;margin:0 0 12px;color:var(--muted,GrayText)}#diagnostic-text{white-space:pre-wrap;max-height:160px;overflow:auto}p{overflow-wrap:anywhere}pre{white-space:pre-wrap}table{max-width:100%}h1,h2,h3{line-height:1.3}main[data-empty="true"]:before{content:'Add LaTeX text to see the preview.';color:var(--muted,GrayText)}@media(max-width:420px){body{padding:16px}}</style></head><body><p id="status" role="status">Preparing web preview…</p><details id="diagnostics" hidden><summary>Preview details</summary><pre id="diagnostic-text"></pre></details><main aria-label="LaTeX document"></main><script>/*! LaTeX.js\n${license.replace(/<\/script/gi, "<\\/script")}\n*/\n${script}</script></body></html>`;
const sourceDigest = createHash("sha256")
  .update(await readFile(`${root}scripts/latex-html-runtime.mjs`))
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(`${root}package-lock.json`))
  .digest("hex");
for (const directory of ["desktop/assets", "mobile/assets"]) {
  await mkdir(`${root}${directory}`, { recursive: true });
  await writeFile(
    `${root}${directory}/latex-html-runtime.json`,
    JSON.stringify({ sourceDigest, html }) + "\n",
  );
}
