import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const virtualId = "virtual:orbyn-latex-frame";
const resolvedId = "\0" + virtualId;
const root = fileURLToPath(new URL("../../", import.meta.url));
const packageRoot = `${root}node_modules/latex.js/`;
const escapeScript = (value: string) =>
  value.replace(/<\/script/gi, "<\\/script");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64");

/** Bundle the shared root engine independently of Vite's application JS loader.
 * latex.js package loading needs esbuild's CommonJS handling, not browser require.
 */
async function frameHtml() {
  const [engine, bridge, fonts, base, article, license] = await Promise.all([
    build({
      entryPoints: [`${root}scripts/latex-html-runtime.mjs`],
      bundle: true,
      minify: true,
      platform: "browser",
      format: "iife",
      write: false,
      loader: { ".keep": "empty" },
      legalComments: "inline",
      target: ["safari17", "chrome120"],
    }),
    build({
      entryPoints: [`${root}web/tooling/latex-frame-bridge.ts`],
      bundle: true,
      minify: true,
      platform: "browser",
      format: "iife",
      write: false,
      target: ["safari17", "chrome120"],
    }),
    build({
      entryPoints: [`${packageRoot}dist/css/katex.css`],
      bundle: true,
      minify: true,
      write: false,
      loader: { ".woff2": "dataurl" },
    }),
    readFile(`${packageRoot}dist/css/base.css`, "utf8"),
    readFile(`${packageRoot}dist/css/article.css`, "utf8"),
    readFile(`${packageRoot}LICENSE`, "utf8"),
  ]);
  const bridgeScript = escapeScript(bridge.outputFiles[0].text);
  const engineScript = escapeScript(
    `/*! LaTeX.js\n${license}\n*/\n${engine.outputFiles[0].text}`,
  );
  // Base/article CSS imports document fonts. Use the web's system font role,
  // while bundling the third-party KaTeX math fonts as data URLs, with no fetches.
  const styles = [fonts.outputFiles[0].text, base, article]
    .map((css) => css.replace(/@import[^;]+;/g, ""))
    .join("\n");
  const csp = `default-src 'none'; script-src 'sha256-${hash(bridgeScript)}' 'sha256-${hash(engineScript)}'; style-src 'unsafe-inline'; font-src data:; img-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${styles}
:root{--size:15px;--line-height:1.6;font-size:calc(15px * var(--preview-font-scale,1));color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;background:var(--surface,Canvas);color:var(--text,CanvasText);font-family:system-ui,sans-serif;line-height:1.6}body{padding:16px}main,.body{width:auto!important;max-width:100%!important;margin:0!important;padding:0!important;font-family:inherit!important}#status,#diagnostics{font:13px/1.5 system-ui,sans-serif;color:var(--muted,GrayText);margin:0 0 12px}#status:empty,[hidden]{display:none!important}#diagnostic-text{white-space:pre-wrap;max-height:180px;overflow:auto}summary{cursor:pointer;min-height:36px}p{overflow-wrap:anywhere}pre{white-space:pre-wrap}table{max-width:100%}h1,h2,h3{line-height:1.3}main[data-empty="true"]:before{content:'Add LaTeX text to see the preview.';color:var(--muted,GrayText)}:focus-visible{outline:2px solid var(--text,CanvasText);outline-offset:3px}@media(pointer:coarse){summary{min-height:44px}}
</style></head><body><p id="status" role="status">Preparing preview…</p><details id="diagnostics" hidden><summary>Preview details</summary><pre id="diagnostic-text"></pre></details><main aria-label="LaTeX document"></main><script>${bridgeScript}</script><script>${engineScript}</script></body></html>`;
}

export function latexFrame(): Plugin {
  let html: Promise<string> | null = null;
  return {
    name: "orbyn-web-latex-frame",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      this.addWatchFile(`${root}scripts/latex-html-runtime.mjs`);
      this.addWatchFile(`${root}web/tooling/latex-frame-bridge.ts`);
      html ??= frameHtml();
      return `export default ${JSON.stringify(await html)};`;
    },
    watchChange(id) {
      if (
        id.endsWith("latex-html-runtime.mjs") ||
        id.endsWith("latex-frame-bridge.ts")
      )
        html = null;
    },
  };
}
