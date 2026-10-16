import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const sourceDigest = createHash("sha256")
  .update(await readFile(new URL("scripts/latex-html-runtime.mjs", root)))
  .update(await readFile(new URL("scripts/build-latex-html.mjs", root)))
  .update(await readFile(new URL("package-lock.json", root)))
  .digest("hex");
const desktop = JSON.parse(
  await readFile(
    new URL("desktop/assets/latex-html-runtime.json", root),
    "utf8",
  ),
);
const mobile = JSON.parse(
  await readFile(
    new URL("mobile/assets/latex-html-runtime.json", root),
    "utf8",
  ),
);
if (
  desktop.sourceDigest !== sourceDigest ||
  mobile.sourceDigest !== sourceDigest ||
  desktop.html !== mobile.html
)
  throw new Error("LaTeX HTML assets are stale. Run npm run build:latex-html.");
console.log("LaTeX HTML runtime provenance and web/mobile parity passed.");
