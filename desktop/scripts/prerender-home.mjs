// Writes the homepage into dist/index.html after `vite build`.
//
// The app is a single page that starts empty and draws itself with script.
// Google runs that script eventually, but not every crawler runs any, and a
// link preview never does — so without this, the words that say what Orbyn is
// reached none of them. Here the page is rendered once, on the build machine,
// and placed where the empty div was. The app replaces it when it starts.

import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist-prerender");
const page = resolve(root, "dist/index.html");

await build({
  root,
  logLevel: "warn",
  build: {
    ssr: "src/prerender.tsx",
    outDir,
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "prerender.mjs" } },
  },
});

try {
  const { renderHome } = await import(
    pathToFileURL(resolve(outDir, "prerender.mjs")).href
  );
  const { html, palette, faqLd } = renderHome();
  let index = await readFile(page, "utf8");

  const marks = ["<!--home-->", "<!--faq-ld-->", "<head>"];
  for (const mark of marks)
    if (!index.includes(mark))
      throw new Error(`index.html has no ${mark} to fill in.`);

  index = index
    .replace("<!--home-->", html)
    .replace(
      "<!--faq-ld-->",
      `<script type="application/ld+json">${faqLd}</script>`,
    )
    // Before the app's stylesheet, as main.tsx prepends it, so the dark
    // values in the stylesheet still win.
    .replace("<head>", `<head>\n    <style>${palette}</style>`);

  await writeFile(page, index);
  console.log(
    `Homepage written into dist/index.html (${Math.round(html.length / 1024)} kB of HTML).`,
  );
} finally {
  await rm(outDir, { recursive: true, force: true });
}
