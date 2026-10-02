import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceDigest = createHash("sha256")
  .update(await readFile(`${root}scripts/mermaid-runtime.mjs`))
  .update(
    await readFile(
      new URL("../../packages/core/src/mermaid.ts", import.meta.url),
    ),
  )
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(`${root}package.json`))
  .update(await readFile(new URL("../../package-lock.json", import.meta.url)))
  .digest("hex");
const result = await build({
  entryPoints: [`${root}scripts/mermaid-runtime.mjs`],
  alias: {
    "@orbyn/core": fileURLToPath(
      new URL("../../packages/core/src/mermaid.ts", import.meta.url),
    ),
  },
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari15", "chrome100"],
  write: false,
  legalComments: "inline",
});
const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:transparent}body{overflow:auto}#diagram{padding:12px;width:max-content;margin:0 auto}svg{display:block}</style></head><body><div id="diagram"></div><script>${script}</script></body></html>`;
await mkdir(`${root}assets`, { recursive: true });
await writeFile(
  `${root}assets/mermaid-runtime.json`,
  JSON.stringify({ sourceDigest, html }),
);
