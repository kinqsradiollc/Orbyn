#!/usr/bin/env node
// Imports the product preview files from the internal designs into site/previews/,
// changed only so they run under the site's Content-Security-Policy:
//   - fonts come from /fonts (self-hosted) instead of Google Fonts;
//   - each <style> moves into <name>.css and each <script> into <name>.<n>.js;
//   - each style="" attribute becomes a generated class whose rule has the same
//     declarations and outranks every class rule, as an inline style does;
//   - the walkthroughs' reduced-motion sequence sets its frame sizes through
//     element.style instead of an inline style attribute.
// The page look and behaviour stay the same; scripts/check-previews.mjs compares them.
//
//   node scripts/import-previews.mjs <folder with the design's previews/*.html>
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) { console.error("usage: node scripts/import-previews.mjs <previews folder>"); process.exit(2); }
const out = join(root, "site/previews");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const FONT_LINKS = /<link rel="preconnect"[^>]*>|<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g;

// The walkthroughs' reduced-motion view writes style="width:..;height:.." into HTML.
const WK_FROM = `'<figure class="wk-s"><div class="wk-sw" style="width:'+W+'px;height:'+H+'px">'+orig[s.f]+'</div>`;
const WK_TO = `'<figure class="wk-s"><div class="wk-sw">'+orig[s.f]+'</div>`;
const WK_AFTER = /(seq\.innerHTML=CFG\.seq\.map\(function\(s,i\)\{[\s\S]*?\}\)\.join\(''\);)/;

let total = 0;
for (const file of readdirSync(src).filter((f) => f.endsWith(".html")).sort()) {
  const name = basename(file, ".html");
  let html = readFileSync(join(src, file), "utf8");
  html = html.replace(FONT_LINKS, "");
  if (/https?:\/\/(?!www\.w3\.org)/.test(html)) throw new Error(`${file}: has an external URL`);
  if (/\son[a-z]+=/i.test(html)) throw new Error(`${file}: has an inline event handler`);

  const styles = [];
  html = html.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => { styles.push(css); return ""; });
  const scripts = [];
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => {
    let code = js;
    if (code.includes(WK_FROM)) {
      code = code.replace(WK_FROM, WK_TO).replace(WK_AFTER, "$1seq.querySelectorAll('.wk-sw').forEach(function(e){e.style.width=W+'px';e.style.height=H+'px'});");
      if (code.includes("style=\"width:")) throw new Error(`${file}: walkthrough patch did not apply`);
    }
    if (/style=["']/.test(code)) throw new Error(`${file}: a script writes an inline style`);
    scripts.push(code);
    return `<script src="${name}.${scripts.length}.js"></script>`;
  });

  // style="" attributes, in start tags only.
  const rules = new Map();
  html = html.replace(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?(\/?)>/g, (tag, tagName, attrs = "", slash) => {
    const m = attrs.match(/\sstyle=(?:"([^"]*)"|'([^']*)')/);
    if (!m) return tag;
    const decls = unescape(m[1] ?? m[2]).trim().replace(/;$/, "");
    const cls = "s" + createHash("sha256").update(decls).digest("hex").slice(0, 7);
    rules.set(cls, decls);
    let rest = attrs.replace(m[0], "");
    const c = rest.match(/\sclass=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/);
    rest = c ? rest.replace(c[0], ` class="${(c[1] ?? c[2] ?? c[3]).trim()} ${cls}"`) : `${rest} class="${cls}"`;
    return `<${tagName}${rest}${slash}>`;
  });
  if (/\sstyle=["']/.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) throw new Error(`${file}: a style attribute is left`);

  // :not(#_) lifts each rule above any class selector, as an inline style is.
  const generated = [...rules].map(([cls, d]) => `.${cls}:not(#_){${d}}`).join("\n");
  // Selectors that matched on the style attribute's text now match its class.
  const css = styles.join("\n").replace(/\[style\*=(?:"([^"]*)"|'([^']*)'|([^\]]*))\]/g, (_, a, b2, c) => {
    const needle = a ?? b2 ?? c;
    const hits = [...rules].filter(([, d]) => d.includes(needle)).map(([cls]) => "." + cls);
    return hits.length ? `:is(${hits.join(",")})` : ":not(*)";
  });
  if (/\[style[~|^$*]?=/.test(css)) throw new Error(`${file}: a style attribute selector is left`);
  writeFileSync(join(out, `${name}.css`), `/* ${file}, from the internal designs. */\n${css}\n/* Former style attributes. */\n${generated}\n`);
  scripts.forEach((js, i) => writeFileSync(join(out, `${name}.${i + 1}.js`), js.trim() + "\n"));
  html = html.replace("</head>", `<link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="${name}.css"></head>`);
  writeFileSync(join(out, file), html);
  total++;
}
writeFileSync(join(out, "fonts.css"), `/* The site's own fonts, for the previews. */
@font-face{font-family:"Geist";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/geist-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"Geist";font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/geist-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/jetbrains-mono-latin-500-normal.woff2) format("woff2")}
`);
console.log(`Imported ${total} previews into site/previews/.`);
