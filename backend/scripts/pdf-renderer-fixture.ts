/** Offline synthetic renderer qualification; never opens the app or a user's browser profile. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { docToHtml, type DocBlock } from "@orbyn/core";
import { createMathHtml } from "../src/lib/math-html.js";
import { openPdfBrowser } from "../src/modules/docs/pdf-browser.js";
import { renderPdfSnapshot } from "../src/modules/docs/pdf-renderer.js";
import { mermaidFixtures } from "../tests/helpers/mermaid-fixtures.js";

const executable = process.env.PDF_TEST_CHROME;
if (!executable)
  throw new Error(
    "Set PDF_TEST_CHROME to the local sandboxed Chromium binary.",
  );
const output = process.env.PDF_TEST_OUTPUT ?? "/tmp/orbyn-pdf-renderer-qa";
const blocks: DocBlock[] = [
  { type: "heading", level: 2, text: "Math and text" },
  {
    type: "paragraph",
    text: "An inline fraction $\\frac{a}{b}$ and integral $\\int_0^1 x^2\\,dx$ remain typeset.",
  },
  { type: "math", text: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}" },
  {
    type: "paragraph",
    text: "Bold **work**, *emphasis*, and Unicode: λ, Ω, 中文.",
  },
  {
    type: "code",
    lang: "js",
    text: 'const contained = "' + "long-code-".repeat(35) + '";',
  },
  {
    type: "table",
    text:
      "| Field | Value |\n| --- | --- |\n| Long value | " +
      "unbroken".repeat(35) +
      " |",
  },
];
for (const fixture of mermaidFixtures)
  blocks.push(
    { type: "heading", level: 2, text: fixture.kind },
    {
      type: "paragraph",
      text: "Synthetic fixture rendered by the shared strict first-party engine.",
    },
    { type: "code", lang: "mermaid", text: fixture.source },
  );
const html = docToHtml("Document export renderer QA", blocks, {
  math: createMathHtml(),
  diagramSources: true,
}).replace(
  "</style>",
  "h2 { break-before: page; } h1 + h2 { break-before: auto; }</style>",
);
await mkdir(output, { recursive: true });
const pdf = await renderPdfSnapshot({
  html,
  executable,
  open: async (binary, signal) => {
    const browser = await openPdfBrowser(binary, signal);
    return {
      ...browser,
      command: async <T>(
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
      ): Promise<T> => {
        if (
          method === "Page.setDocumentContent" &&
          String(params.html).includes("export-diagram")
        )
          await writeFile(
            join(output, "print-snapshot.html"),
            String(params.html),
          );
        return browser.command<T>(method, params, sessionId);
      },
    };
  },
});
await writeFile(join(output, "doc-export-renderer-qa.pdf"), pdf);
process.stdout.write(
  JSON.stringify({
    pdf: join(output, "doc-export-renderer-qa.pdf"),
    bytes: pdf.length,
    diagramFamilies: mermaidFixtures.map((fixture) => fixture.kind),
  }) + "\n",
);
