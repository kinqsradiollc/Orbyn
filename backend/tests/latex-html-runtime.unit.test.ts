import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const nativeRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
const { JSDOM, VirtualConsole } = nativeRequire("jsdom");
const runtime = JSON.parse(
  readFileSync(
    new URL("../../desktop/assets/latex-html-runtime.json", import.meta.url),
    "utf8",
  ),
);
const delay = () => new Promise((resolve) => setTimeout(resolve, 240));
function mount() {
  const console = new VirtualConsole();
  const errors: string[] = [];
  console.on("jsdomError", (error: Error) => errors.push(error.message));
  const dom = new JSDOM(runtime.html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window: any) {
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  const update = async (source: string) => {
    dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data: JSON.stringify({ type: "orbyn-latex-source", source }),
      }),
    );
    await delay();
  };
  return { dom, update, errors };
}
const documentSource = (body: string) => String.raw`\documentclass{article}
\begin{document}
${body}
\end{document}`;
test("actual bundled HTML renderer previews complete prose, headings, lists and maths without PDF", async () => {
  const { dom, update, errors } = mount();
  try {
    await update(
      documentSource(
        String.raw`\section{Plan}A \textbf{clear} note. $a^2+b^2=c^2$ \begin{itemize}\item Read\item Write\end{itemize}`,
      ),
    );
    const output = dom.window.document.querySelector("main")!;
    assert.match(output.textContent!, /Plan/);
    assert.match(output.textContent!, /clear/);
    assert.match(output.textContent!, /Read/);
    assert.ok(output.querySelector(".katex"));
    assert.ok(output.querySelector("li"));
    assert.equal(
      dom.window.document.querySelector("canvas, iframe, object"),
      null,
    );
    assert.deepEqual(errors, []);
  } finally {
    dom.window.close();
  }
});
test("default starter renders, typing errors preserve last success, and repair updates the same host", async () => {
  const { dom, update } = mount();
  try {
    const starter = String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb}
\begin{document}Working $x^2$\end{document}`;
    await update(starter);
    const output = dom.window.document.querySelector("main")!;
    assert.match(output.textContent!, /Working/);
    assert.equal(dom.window.document.querySelector("#status")!.textContent, "");
    const previous = output.innerHTML;
    await update(documentSource(String.raw`\textbf{Incomplete`));
    assert.equal(output.innerHTML, previous);
    assert.match(
      dom.window.document.querySelector("#status")!.textContent!,
      /Preview paused/,
    );
    await update(documentSource(String.raw`Repaired \emph{text}.`));
    assert.match(output.textContent!, /Repaired/);
    assert.equal(dom.window.document.querySelector("#status")!.textContent, "");
    const child = output.firstChild;
    await update(documentSource(String.raw`Repaired \emph{text}.`));
    assert.equal(
      output.firstChild,
      child,
      "identical source must not rebuild the rendered DOM",
    );
  } finally {
    dom.window.close();
  }
});
test("unsupported input and resource markup cannot replace the host, navigate or load document resources", async () => {
  const { dom, update } = mount();
  try {
    await update(documentSource("Safe content"));
    const output = dom.window.document.querySelector("main")!;
    const previous = output.innerHTML;
    await update(documentSource(String.raw`\unknownOrbynCommand{secret}`));
    assert.equal(output.innerHTML, previous);
    await update(
      documentSource(
        String.raw`<img src="https://example.invalid/leak"> \href{javascript:alert(1)}{Link}`,
      ),
    );
    assert.equal(
      output.querySelector(
        "script, iframe, img, object, [href], [src], [onload]",
      ),
      null,
    );
    assert.match(runtime.html, /connect-src 'none'/);
    assert.match(runtime.html, /img-src 'none'/);
    assert.match(runtime.html, /font-src data:/);
    await update("x".repeat(20_001));
    assert.match(
      dom.window.document.querySelector("#status")!.textContent!,
      /too long/,
    );
  } finally {
    dom.window.close();
  }
});

test("undo to last good cancels a queued render and clears stale error diagnostics", async () => {
  const { dom, update } = mount();
  try {
    const first = documentSource("First current document");
    await update(first);
    const output = dom.window.document.querySelector("main")!;
    const child = output.firstChild;
    const send = (source: string) =>
      dom.window.dispatchEvent(
        new dom.window.MessageEvent("message", {
          data: JSON.stringify({ type: "orbyn-latex-source", source }),
        }),
      );
    send(documentSource("Stale queued document"));
    send(first);
    await delay();
    assert.equal(output.firstChild, child);
    assert.doesNotMatch(output.textContent!, /Stale queued/);
    await update(documentSource(String.raw`\unknownOrbynCommand{broken}`));
    assert.match(
      dom.window.document.querySelector("#status")!.textContent!,
      /Preview paused/,
    );
    await update(first);
    assert.equal(output.firstChild, child);
    assert.equal(dom.window.document.querySelector("#status")!.textContent, "");
    assert.equal(
      dom.window.document.querySelector("#diagnostics")!.hidden,
      true,
    );
  } finally {
    dom.window.close();
  }
});

test("a fresh source owner cannot inherit another document's last-good output", async () => {
  const first = mount();
  const second = mount();
  try {
    await first.update(documentSource("First owner visible"));
    await second.update(
      documentSource(String.raw`\unknownOrbynCommand{unsupported secondary}`),
    );
    const output = second.dom.window.document.querySelector("main")!;
    assert.equal(output.textContent, "");
    assert.doesNotMatch(
      second.dom.window.document.body.textContent!,
      /First owner visible/,
    );
    await second.update(documentSource("Second owner visible"));
    const lastGood = output.innerHTML;
    await second.update(
      documentSource(String.raw`\unknownOrbynCommand{unsupported secondary}`),
    );
    assert.equal(output.innerHTML, lastGood);
    assert.match(output.textContent!, /Second owner visible/);
  } finally {
    first.dom.window.close();
    second.dom.window.close();
  }
});
